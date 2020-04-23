// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Kind } from '../Options'
import { Context, Record, Member, Observable, Handle, Observer } from './Data'
import { CopyOnWriteProxy } from './Hooks'

export const SYM_OBJECT: unique symbol = Symbol('r-object')
export const SYM_METHOD: unique symbol = Symbol('r-method')
export const SYM_UNMOUNT: unique symbol = Symbol('r-unmount')
export const SYM_BLANK: unique symbol = Symbol('r-blank')
export const SYM_TRIGGERS: unique symbol = Symbol('r-triggers')
const UNDEFINED_TIMESTAMP = Number.MAX_SAFE_INTEGER - 1

// RObject

export class RObject extends Handle {
  get ['<this @ context>'](): any {
    const result: any = {}
    const d = Snapshot.readable().read(this).data
    for (const m in d) {
      const v = d[m]
      if (v instanceof Observable)
        result[m] = v.value
      else if (v === STATELESS)
        result[m] = this.stateless[m]
      else
        result[m] = v
    }
    return result
  }
}

// RStateless

class RStateless {
}

export const STATELESS: object = Object.freeze(new RStateless())

// Snapshot

export class Snapshot implements Context {
  static idGen: number = -1
  static stampGen: number = 1
  static pending: Snapshot[] = []
  static oldest: Snapshot | undefined = undefined
  static garbageCollectionSummaryInterval: number = Number.MAX_SAFE_INTEGER
  static lastGarbageCollectionSummaryTimestamp: number = Date.now()
  static totalRObjectCount: number = 0
  static totalRecordCount: number = 0

  readonly id: number
  readonly hint: string
  get timestamp(): number { return this.stamp }
  private stamp: number
  private bumper: number
  readonly token: any
  readonly changeset: Map<RObject, Record>
  readonly triggers: Observer[]
  completed: boolean

  constructor(hint: string, caching: any) {
    this.id = ++Snapshot.idGen
    this.hint = hint
    this.stamp = UNDEFINED_TIMESTAMP
    this.bumper = 100
    this.token = caching
    this.changeset = new Map<RObject, Record>()
    this.triggers = []
    this.completed = false
  }

  // To be redefined by Transaction and Cache implementations
  static readable: () => Snapshot = undef
  static writable: () => Snapshot = undef
  static markChanged: (r: Record, m: Member, value: any, changed: boolean) => void = undef
  static markViewed: (r: Record, m: Member, value: Observable, kind: Kind, weak: boolean) => void = undef
  static isConflicting: (oldValue: any, newValue: any) => boolean = undef
  static finalizeChangeset = (snapshot: Snapshot, error: Error | undefined): void => { /* nop */ }

  read(o: RObject): Record {
    const r = this.tryRead(o)
    if (r === NIL) /* istanbul ignore next */
      throw misuse(`object ${Hints.obj(o)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    return r
  }

  tryRead(o: RObject): Record {
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

  write(o: RObject, m: Member, value: any, token?: any): Record {
    let r: Record = this.tryRead(o)
    if (r.data[m] !== STATELESS) {
      this.guard(o, r, m, value, token)
      if (r.snapshot !== this) {
        const data = {...m === SYM_OBJECT ? value : r.data}
        Reflect.set(data, SYM_OBJECT, o)
        r = new Record(this, r, data)
        this.changeset.set(o, r)
        o.changing = r
        o.writers++
      }
    }
    else
      r = NIL
    return r
  }

  static unmount(obj: any): void {
    const ctx = Snapshot.writable()
    const o = Utils.get<RObject>(obj, SYM_OBJECT)
    if (o) {
      const r: Record = ctx.write(o, SYM_UNMOUNT, SYM_UNMOUNT)
      if (r !== NIL) {
        r.data[SYM_UNMOUNT] = SYM_UNMOUNT
        Snapshot.markChanged(r, SYM_UNMOUNT, SYM_UNMOUNT, true)
      }
    }
  }

  private guard(o: RObject, r: Record, m: Member, value: any, token: any): void {
    if (this.completed)
      throw misuse(`stateful property ${Hints.obj(o, m)} can only be modified inside actions and triggers`)
    if (m !== SYM_OBJECT && value !== SYM_OBJECT && this.token !== undefined && token !== this.token && (r.snapshot !== this || r.prev.record !== NIL))
      throw misuse(`cache must have no side effects: ${this.hint} should not change ${Hints.record(r, m)}`)
    if (r === NIL && m !== SYM_OBJECT && value !== SYM_OBJECT) /* istanbul ignore next */
      throw misuse(`member ${Hints.record(r, m)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
  }

  acquire(outer: Snapshot): void {
    if (!this.completed && this.stamp === UNDEFINED_TIMESTAMP) {
      const ahead = this.token === undefined || outer.stamp === UNDEFINED_TIMESTAMP
      this.stamp = ahead ? Snapshot.stampGen : outer.stamp
      Snapshot.pending.push(this)
      if (Snapshot.oldest === undefined)
        Snapshot.oldest = this
      if (Dbg.isOn && Dbg.logging.transactions) Dbg.log('╔══', `v${this.stamp}`, `${this.hint}`)
    }
  }

  bumpDueTo(r: Record): void {
    if (r.snapshot !== this) { // snapshot should not bump itself
      const timestamp = r.snapshot.timestamp
      if (timestamp > this.bumper)
        this.bumper = timestamp
    }
  }

  rebase(): Record[] | undefined { // return conflicts
    let conflicts: Record[] | undefined = undefined
    if (this.changeset.size > 0) {
      this.changeset.forEach((r: Record, o: RObject) => {
        if (r.prev.record !== o.head) {
          const merged = Snapshot.merge(r, o.head)
          if (r.conflicts.size > 0) {
            if (!conflicts)
              conflicts = []
            conflicts.push(r)
          }
          if (Dbg.isOn && Dbg.logging.changes) Dbg.log('╠╝', '', `${Hints.record(r)} is merged with ${Hints.record(o.head)} among ${merged} properties with ${r.conflicts.size} conflicts.`)
        }
      })
      if (this.token === undefined) {
        if (this.bumper > 100) { // if transaction ever touched existing objects
          this.bumper = this.stamp // not needed? (just for debug)
          this.stamp = ++Snapshot.stampGen
        }
        else
          this.stamp = this.bumper + 1
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
          if (Dbg.isOn && Dbg.logging.changes) Dbg.log('║╠', '', `${Hints.record(ours, m)} <> ${Hints.record(head, m)}`, 0, ' *** CONFLICT ***')
          ours.conflicts.set(m, head)
        }
      }
      else {
        const conflict = Snapshot.isConflicting(head.data[m], ours.prev.record.data[m])
        if (conflict)
          ours.conflicts.set(m, head)
        if (Dbg.isOn && Dbg.logging.changes) Dbg.log('║╠', '', `${Hints.record(ours, m)} ${conflict ? '<>' : '=='} ${Hints.record(head, m)}`, 0, conflict ? ' *** CONFLICT ***' : undefined)
      }
    })
    Utils.copyAllMembers(merged, ours.data) // overwrite with merged copy
    ours.prev.record = head // rebase is completed
    return counter
  }

  complete(error?: any): void {
    this.completed = true
    this.changeset.forEach((r: Record, o: RObject) => {
      r.changes.forEach(m => CopyOnWriteProxy.seal(r.data[m], o.proxy, m))
      if (Dbg.isOn) Snapshot.freezeRecord(r)
      o.writers--
      if (o.writers === 0)
        o.changing = undefined
      if (!error) {
        o.head = r
        if (Snapshot.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
          Snapshot.totalRecordCount++
          // console.log('rec++')
          if (r.prev.record === NIL) {
            Snapshot.totalRObjectCount++
            // console.log('obj++')
          }
        }
        if (Dbg.isOn && Dbg.logging.changes) {
          const members: string[] = []
          r.changes.forEach(m => members.push(m.toString()))
          const s = members.join(', ')
          Dbg.log('║', '√', `${Hints.record(r)}(${s}) is ${r.prev.record === NIL ? 'constructed' : `applied on top of ${Hints.record(r.prev.record)}`}`)
        }
      }
    })
    if (Dbg.isOn && Dbg.logging.transactions)
      Dbg.log(this.stamp < UNDEFINED_TIMESTAMP ? '╚══' : /* istanbul ignore next */ '═══', `v${this.stamp}`, `${this.hint} - ${error ? 'CANCEL' : 'APPLY'}(${this.changeset.size})${error ? ` - ${error}` : ''}`)
    Snapshot.finalizeChangeset(this, error)
  }

  collect(): void {
    if (Dbg.isOn) {
      Utils.freezeMap(this.changeset)
      Object.freeze(this.triggers)
      Object.freeze(this)
    }
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
        const now = Date.now()
        if (now - Snapshot.lastGarbageCollectionSummaryTimestamp > Snapshot.garbageCollectionSummaryInterval) {
          Dbg.log('', '[G]', `Total object/record count: ${Snapshot.totalRObjectCount}/${Snapshot.totalRecordCount}`)
          Snapshot.lastGarbageCollectionSummaryTimestamp = now
        }
      }
    }
  }

  private unlinkHistory(): void {
    if (Dbg.isOn && Dbg.logging.gc) Dbg.log('', '[G]', `Dismiss history below v${this.stamp}t${this.id} (${this.hint})`)
    this.changeset.forEach((r: Record, o: RObject) => {
      if (Dbg.isOn && Dbg.logging.gc && r.prev.record !== NIL) Dbg.log(' ', '  ', `${Hints.record(r.prev.record)} is ready for GC because overwritten by ${Hints.record(r)}`)
      if (Snapshot.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
        if (r.prev.record !== NIL) {
          Snapshot.totalRecordCount--
          // console.log('rec--')
        }
        if (r.changes.has(SYM_UNMOUNT)) {
          Snapshot.totalRObjectCount--
          // console.log('obj--')
        }
      }
      r.prev.record = NIL // unlink history
    })
  }

  static _init(): void {
    const nil = NIL.snapshot as Snapshot // workaround
    nil.acquire(nil)
    nil.complete()
    nil.collect()
    Snapshot.freezeRecord(NIL)
    Snapshot.idGen = 100
    Snapshot.stampGen = 101
    Snapshot.oldest = undefined
  }
}

// Hints

export class Hints {
  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const o = Utils.get<RObject>(obj, SYM_OBJECT)
      if (o)
        o.hint = hint
    }
    return obj
  }

  static getHint(obj: object, full: boolean = false): string | undefined {
    const o = Utils.get<RObject>(obj, SYM_OBJECT)
    return o ? (full ? `${o.hint}#${o.id}` : o.hint) : undefined
  }

  static obj(o: RObject | undefined, m?: Member | undefined, stamp?: number, tran?: number, typeless?: boolean): string {
    const s = (o === undefined)
      ? 'nil'
      : (typeless
        ? (stamp === undefined ? `#${o.id}` : `v${stamp}t${tran}#${o.id}`)
        : (stamp === undefined ? `#${o.id} ${o.hint}` : `v${stamp}t${tran}#${o.id} ${o.hint}`))
    return m !== undefined ? `${s}.${m.toString()}` : s
  }

  static record(r: Record, m?: Member, typeless?: boolean): string {
    const o = Utils.get<RObject | undefined>(r.data, SYM_OBJECT)
    return Hints.obj(o, m, r.snapshot.timestamp, r.snapshot.id, typeless)
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
    return `${theirs.snapshot.hint} on ${Hints.record(theirs, m)}`
  }
}

export const NIL = new Record(new Snapshot('<nil>', undefined), undefined, {})
