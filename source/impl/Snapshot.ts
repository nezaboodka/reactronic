// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Kind } from '../Options'
import { Context, Record, Member, Observable, Instance, Observer } from './Data'
import { CopyOnWriteProxy } from './Hooks'

export const SYM_INSTANCE: unique symbol = Symbol('r-instance')
export const SYM_METHOD: unique symbol = Symbol('r-method')
export const SYM_UNMOUNT: unique symbol = Symbol('r-unmount')
export const SYM_STATELESS: unique symbol = Symbol('r-stateless')
export const SYM_BLANK: unique symbol = Symbol('r-blank')
export const SYM_TRIGGERS: unique symbol = Symbol('r-triggers')
const UNDEFINED_TIMESTAMP = Number.MAX_SAFE_INTEGER - 1

// Snapshot

export class Snapshot implements Context {
  static lastId: number = -1
  static headStamp: number = 1
  static pending: Snapshot[] = []
  static oldest: Snapshot | undefined = undefined

  readonly id: number
  readonly hint: string
  get timestamp(): number { return this.stamp }
  private stamp: number
  private bumper: number
  readonly token: any
  readonly changeset: Map<Instance, Record>
  readonly triggers: Observer[]
  completed: boolean

  constructor(hint: string, caching: any) {
    this.id = ++Snapshot.lastId
    this.hint = hint
    this.stamp = UNDEFINED_TIMESTAMP
    this.bumper = 1
    this.token = caching
    this.changeset = new Map<Instance, Record>()
    this.triggers = []
    this.completed = false
  }

  // To be redefined by Action and Cache implementations
  static readable: () => Snapshot = undef
  static writable: () => Snapshot = undef
  static markChanged: (r: Record, m: Member, value: any, changed: boolean) => void = undef
  static markViewed: (r: Record, m: Member, value: Observable, kind: Kind, weak: boolean) => void = undef
  static isConflicting: (oldValue: any, newValue: any) => boolean = undef
  static finalizeChangeset = (snapshot: Snapshot, error: Error | undefined): void => { /* nop */ }

  read(o: Instance): Record {
    const r = this.tryRead(o)
    if (r === NIL) /* istanbul ignore next */
      throw misuse(`object ${Hints.instance(o)} doesn't exist in snapshot v${this.stamp}`)
    return r
  }

  tryRead(o: Instance): Record {
    let r: Record | undefined = o.changing
    if (r && r.snapshot !== this) {
      r = this.changeset.get(o)
      if (r)
        o.changing = r // remember last changing record
    }
    if (!r) {
      r = o.head
      while (r !== NIL && r.snapshot.timestamp > this.timestamp)
        r = r.prev.record
    }
    return r
  }

  write(o: Instance, m: Member, value: any, token?: any): Record {
    let r: Record = this.tryRead(o)
    if (r.data[m] !== SYM_STATELESS) {
      this.guard(o, r, m, value, token)
      if (r.snapshot !== this) {
        const data = {...m === SYM_INSTANCE ? value : r.data}
        Reflect.set(data, SYM_INSTANCE, o)
        r = new Record(this, o.head, data)
        this.changeset.set(o, r)
        o.changing = r
        o.writers++
      }
    }
    else
      r = NIL
    return r
  }

  static unmount(...objects: any[]): void {
    const ctx = Snapshot.writable()
    for (const x of objects) {
      const o = Utils.get<Instance>(x, SYM_INSTANCE)
      if (o) {
        const r: Record = ctx.write(o, SYM_UNMOUNT, SYM_UNMOUNT)
        if (r !== NIL) {
          r.data[SYM_UNMOUNT] = SYM_UNMOUNT
          Snapshot.markChanged(r, SYM_UNMOUNT, SYM_UNMOUNT, true)
        }
      }
    }
  }

  private guard(o: Instance, r: Record, m: Member, value: any, token: any): void {
    if (this.completed)
      throw misuse(`stateful property ${Hints.instance(o, m)} can only be modified inside actions and triggers`)
    if (m !== SYM_INSTANCE && value !== SYM_INSTANCE && this.token !== undefined && token !== this.token && (r.snapshot !== this || r.prev.record !== NIL))
      throw misuse(`cache must have no side effects: ${this.hint} should not change ${Hints.record(r, m)}`)
    if (r === NIL && m !== SYM_INSTANCE && value !== SYM_INSTANCE) /* istanbul ignore next */
      throw misuse(`object ${Hints.record(r, m)} doesn't exist in snapshot v${this.stamp}`)
  }

  acquire(outer: Snapshot): void {
    if (!this.completed && this.stamp === UNDEFINED_TIMESTAMP) {
      const ahead = this.token === undefined || outer.stamp === UNDEFINED_TIMESTAMP
      this.stamp = ahead ? Snapshot.headStamp : outer.stamp
      Snapshot.pending.push(this)
      if (Snapshot.oldest === undefined)
        Snapshot.oldest = this
      if (Dbg.isOn && Dbg.trace.transactions) Dbg.log('╔══', `v${this.stamp}`, `${this.hint}`)
    }
  }

  bump(timestamp: number): void {
    if (timestamp > this.bumper)
      this.bumper = timestamp
  }

  rebase(): Record[] | undefined { // return conflicts
    let conflicts: Record[] | undefined = undefined
    if (this.changeset.size > 0) {
      this.changeset.forEach((r: Record, o: Instance) => {
        if (r.prev.record !== o.head) {
          const merged = Snapshot.merge(r, o.head)
          if (r.conflicts.size > 0) {
            if (!conflicts)
              conflicts = []
            conflicts.push(r)
          }
          if (Dbg.isOn && Dbg.trace.changes) Dbg.log('╠╝', '', `${Hints.record(r)} is merged with ${Hints.record(o.head)} among ${merged} properties with ${r.conflicts.size} conflicts.`)
        }
      })
      if (this.token === undefined) {
        this.bumper = this.stamp
        this.stamp = ++Snapshot.headStamp
      }
      else
        this.stamp = this.bumper // downgrade timestamp of renewed cache
    }
    return conflicts
  }

  private static merge(ours: Record, head: Record): number {
    let counter: number = 0
    const unmounted: boolean = head.changes.has(SYM_UNMOUNT)
    const merged = {...head.data} // clone
    ours.changes.forEach(m => {
      counter++
      merged[m] = ours.data[m]
      if (unmounted || m === SYM_UNMOUNT) {
        if (unmounted !== (m === SYM_UNMOUNT)) {
          if (Dbg.isOn && Dbg.trace.changes) Dbg.log('║╠', '', `${Hints.record(ours, m)} <> ${Hints.record(head, m)}`, 0, ' *** CONFLICT ***')
          ours.conflicts.set(m, head)
        }
      }
      else {
        const conflict = Snapshot.isConflicting(head.data[m], ours.prev.record.data[m])
        if (conflict)
          ours.conflicts.set(m, head)
        if (Dbg.isOn && Dbg.trace.changes) Dbg.log('║╠', '', `${Hints.record(ours, m)} ${conflict ? '<>' : '=='} ${Hints.record(head, m)}`, 0, conflict ? ' *** CONFLICT ***' : undefined)
      }
    })
    Utils.copyAllMembers(merged, ours.data) // overwrite with merged copy
    ours.prev.record = head // rebase is completed
    return counter
  }

  complete(error?: any): void {
    this.completed = true
    this.changeset.forEach((r: Record, o: Instance) => {
      r.changes.forEach(m => CopyOnWriteProxy.seal(r.data[m], o.proxy, m))
      Snapshot.freezeRecord(r)
      o.writers--
      if (o.writers === 0)
        o.changing = undefined
      if (!error) {
        o.head = r
        if (Dbg.isOn && Dbg.trace.changes) {
          const members: string[] = []
          r.changes.forEach(m => members.push(m.toString()))
          const s = members.join(', ')
          Dbg.log('║', '√', `${Hints.record(r)}(${s}) is ${r.prev.record === NIL ? 'constructed' : `applied on top of ${Hints.record(r.prev.record)}`}`)
        }
      }
    })
    if (Dbg.isOn && Dbg.trace.transactions)
      Dbg.log(this.stamp < UNDEFINED_TIMESTAMP ? '╚══' : /* istanbul ignore next */ '═══', `v${this.stamp}`, `${this.hint} - ${error ? 'CANCEL' : 'APPLY'}(${this.changeset.size})${error ? ` - ${error}` : ''}`)
    Snapshot.finalizeChangeset(this, error)
  }

  collect(): void {
    Utils.freezeMap(this.changeset)
    Object.freeze(this.triggers)
    Object.freeze(this)
    this.triggerGarbageCollection()
  }

  static freezeRecord(r: Record): Record {
    Object.freeze(r.data)
    Utils.freezeSet(r.changes)
    Utils.freezeMap(r.conflicts)
    return r
  }

  // static undo(s: Snapshot): void {
  //   s.changeset.forEach((r: Record, o: Instance) => {
  //     r.changes.forEach(m => {
  //       if (r.prev.record !== INIT) {
  //         const prevValue: any = r.prev.record.data[m];
  //         const ctx = Snapshot.write();
  //         const t: Record = ctx.write(h, m, prevValue);
  //         if (t.snapshot === ctx) {
  //           t.data[m] = prevValue;
  //           const v: any = t.prev.record.data[m];
  //           Record.markChanged(t, m, v !== prevValue, prevValue);
  //         }
  //       }
  //     });
  //   });
  // }

  private triggerGarbageCollection(): void {
    if (this.stamp !== 0) {
      if (this === Snapshot.oldest) {
        const p = Snapshot.pending
        p.sort((a, b) => a.stamp - b.stamp)
        let i: number = 0
        while (i < p.length && p[i].completed) {
          p[i].unlinkHistory()
          i++
        }
        Snapshot.pending = p.slice(i)
        Snapshot.oldest = Snapshot.pending[0] // undefined is OK
      }
    }
  }

  private unlinkHistory(): void {
    if (Dbg.isOn && Dbg.trace.gc) Dbg.log('', '[G]', `Dismiss history of v${this.stamp}t${this.id} (${this.hint})`)
    this.changeset.forEach((r: Record, o: Instance) => {
      if (Dbg.isOn && Dbg.trace.gc && r.prev.record !== NIL) Dbg.log(' ', '  ', `${Hints.record(r.prev.record)} is ready for GC because overwritten by ${Hints.record(r)}`)
      r.prev.record = NIL // unlink history
    })
  }

  static _init(): void {
    const nil = NIL.snapshot as Snapshot // workaround
    nil.acquire(nil)
    nil.complete()
    nil.collect()
    Snapshot.freezeRecord(NIL)
    Snapshot.lastId = 100
    Snapshot.headStamp = 101
    Snapshot.oldest = undefined
  }
}

// Hints

export class Hints {
  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const o = Utils.get<Instance>(obj, SYM_INSTANCE)
      if (o)
        o.hint = hint
    }
    return obj
  }

  static getHint(obj: object): string | undefined {
    const o = Utils.get<Instance>(obj, SYM_INSTANCE)
    return o ? o.hint : undefined
  }

  static instance(o: Instance | undefined, m?: Member | undefined, stamp?: number, tran?: number, typeless?: boolean): string {
    const obj = (o === undefined)
      ? 'nil'
      : (typeless
        ? (stamp === undefined ? `#${o.id}` : `v${stamp}t${tran}#${o.id}`)
        : (stamp === undefined ? `#${o.id} ${o.hint}` : `v${stamp}t${tran}#${o.id} ${o.hint}`))
    return m !== undefined ? `${obj}.${m.toString()}` : obj
  }

  static record(r: Record, m?: Member, typeless?: boolean): string {
    const o = Utils.get<Instance | undefined>(r.data, SYM_INSTANCE)
    return Hints.instance(o, m, r.snapshot.timestamp, r.snapshot.id, typeless)
  }

  static conflicts(conflicts: Record[]): string {
    return conflicts.map(ours => {
      const items: string[] = []
      ours.conflicts.forEach((theirs: Record, m: Member) => {
        items.push(Hints.conflictingMemberHint(m, ours, theirs))
      })
      return items.join(', ')
    }).join(', ')
  }

  static conflictingMemberHint(m: Member, ours: Record, theirs: Record): string {
    return Hints.record(theirs, m)
  }
}

export const NIL = new Record(new Snapshot('<nil>', undefined), undefined, {})
