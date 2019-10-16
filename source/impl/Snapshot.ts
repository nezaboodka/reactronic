// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Context, Record, FieldKey, Observable, Handle, Observer } from './Data'
import { CopyOnWriteProxy } from './Hooks'

export const SYM_HANDLE: unique symbol = Symbol('R:HANDLE')
export const SYM_METHOD: unique symbol = Symbol('R:METHOD')
export const SYM_UNMOUNT: unique symbol = Symbol('R:UNMOUNT')
export const SYM_STATELESS: unique symbol = Symbol('R:STATELESS')
export const SYM_BLANK: unique symbol = Symbol('R:BLANK')
export const SYM_TRIGGERS: unique symbol = Symbol('R:TRIGGERS')
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
  readonly caching: any
  readonly changeset: Map<Handle, Record>
  readonly triggers: Observer[]
  applied: boolean

  constructor(hint: string, caching: any) {
    this.id = ++Snapshot.lastId
    this.hint = hint
    this.stamp = UNDEFINED_TIMESTAMP
    this.bumper = 1
    this.caching = caching
    this.changeset = new Map<Handle, Record>()
    this.triggers = []
    this.applied = false
  }

  // To be redefined by Action and Cache implementations
  static readable: () => Snapshot = undef
  static writable: () => Snapshot = undef
  static markChanged: (record: Record, field: FieldKey, value: any, changed: boolean) => void = undef
  static markViewed: (record: Record, field: FieldKey, value: Observable, weak: boolean) => void = undef
  static isConflicting: (oldValue: any, newValue: any) => boolean = undef
  static propagateChanges = (snapshot: Snapshot): void => { /* nop */ }
  static discardChanges = (snapshot: Snapshot): void => { /* nop */ }

  read(h: Handle): Record {
    const r = this.tryRead(h)
    if (r === NIL) /* istanbul ignore next */
      throw misuse(`object ${Hints.handle(h)} doesn't exist in snapshot v${this.stamp}`)
    return r
  }

  tryRead(h: Handle): Record {
    let r: Record | undefined = h.changing
    if (r && r.snapshot !== this) {
      r = this.changeset.get(h)
      if (r)
        h.changing = r // remember last changing record
    }
    if (!r) {
      r = h.head
      while (r !== NIL && r.snapshot.timestamp > this.timestamp)
        r = r.prev.record
    }
    return r
  }

  write(h: Handle, field: FieldKey, value: any, token?: any): Record {
    let r: Record = this.tryRead(h)
    if (r.data[field] !== SYM_STATELESS) {
      this.guard(h, r, field, value, token)
      if (r.snapshot !== this) {
        const data = {...field === SYM_HANDLE ? value : r.data}
        Reflect.set(data, SYM_HANDLE, h)
        r = new Record(this, h.head, data)
        this.changeset.set(h, r)
        h.changing = r
        h.writers++
      }
    }
    else
      r = NIL
    return r
  }

  private guard(h: Handle, r: Record, field: FieldKey, value: any, token: any): void {
    if (this.applied)
      throw misuse(`stateful property ${Hints.handle(h, field)} can only be modified inside actions and triggers`)
    if (field !== SYM_HANDLE && value !== SYM_HANDLE && this.caching !== undefined && token !== this.caching && (r.snapshot !== this || r.prev.record !== NIL))
      throw misuse(`cache must have no side effects: ${this.hint} should not change ${Hints.record(r, field)}`)
    if (r === NIL && field !== SYM_HANDLE && value !== SYM_HANDLE) /* istanbul ignore next */
      throw misuse(`object ${Hints.record(r, field)} doesn't exist in snapshot v${this.stamp}`)
  }

  acquire(outer: Snapshot): void {
    if (!this.applied && this.stamp === UNDEFINED_TIMESTAMP) {
      const ahead = this.caching === undefined || outer.stamp === UNDEFINED_TIMESTAMP
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
      this.changeset.forEach((r: Record, h: Handle) => {
        const merged = Snapshot.rebaseRecord(r, h.head)
        if (merged >= 0) {
          if (r.conflicts.size > 0) {
            if (!conflicts)
              conflicts = []
            conflicts.push(r)
          }
          if (Dbg.isOn && Dbg.trace.changes) Dbg.log('╠╝', '', `${Hints.record(r)} is merged with ${Hints.record(h.head)} among ${merged} properties with ${r.conflicts.size} conflicts.`)
        }
      })
      if (this.caching === undefined) {
        this.bumper = this.stamp
        this.stamp = ++Snapshot.headStamp
      }
      else
        this.stamp = this.bumper // downgrade timestamp of renewed cache
    }
    return conflicts
  }

  private static rebaseRecord(ours: Record, head: Record): number {
    let counter: number = -1
    if (ours.prev.record !== head) {
      counter++
      const unmounted: boolean = head.changes.has(SYM_UNMOUNT)
      const merged = {...head.data} // clone
      ours.changes.forEach(field => {
        counter++
        merged[field] = ours.data[field]
        if (unmounted || field === SYM_UNMOUNT) {
          if (unmounted !== (field === SYM_UNMOUNT)) {
            if (Dbg.isOn && Dbg.trace.changes) Dbg.log('║╠', '', `${Hints.record(ours, field)} <> ${Hints.record(head, field)}`, 0, ' *** CONFLICT ***')
            ours.conflicts.set(field, head)
          }
        }
        else {
          const conflict = Snapshot.isConflicting(head.data[field], ours.prev.record.data[field])
          if (conflict)
            ours.conflicts.set(field, head)
          if (Dbg.isOn && Dbg.trace.changes) Dbg.log('║╠', '', `${Hints.record(ours, field)} ${conflict ? '<>' : '=='} ${Hints.record(head, field)}`, 0, conflict ? ' *** CONFLICT ***' : undefined)
        }
      })
      Utils.copyAllFields(merged, ours.data) // overwrite with merged copy
      ours.prev.record = head // rebase is completed
    }
    return counter
  }

  apply(error?: any): void {
    this.applied = true
    this.changeset.forEach((r: Record, h: Handle) => {
      r.changes.forEach(field => CopyOnWriteProxy.seal(r.data[field], h.proxy, field))
      r.freeze()
      h.writers--
      if (h.writers === 0)
        h.changing = undefined
      if (!error) {
        h.head = r
        if (Dbg.isOn && Dbg.trace.changes) {
          const fields: string[] = []
          r.changes.forEach(field => fields.push(field.toString()))
          const s = fields.join(', ')
          Dbg.log('║', '√', `${Hints.record(r)}(${s}) is applied on top of ${Hints.record(r.prev.record)}`)
        }
      }
    })
    if (Dbg.isOn && Dbg.trace.transactions)
      Dbg.log(this.stamp < UNDEFINED_TIMESTAMP ? '╚══' : /* istanbul ignore next */ '═══', `v${this.stamp}`, `${this.hint} - ${error ? 'CANCEL' : 'APPLY'}(${this.changeset.size})${error ? ` - ${error}` : ''}`)
    !error ? Snapshot.propagateChanges(this) : Snapshot.discardChanges(this)
  }

  collect(): void {
    Utils.freezeMap(this.changeset)
    Object.freeze(this.triggers)
    Object.freeze(this)
    this.triggerGarbageCollection()
  }

  // static undo(s: Snapshot): void {
  //   s.changeset.forEach((r: Record, h: Handle) => {
  //     r.changes.forEach(field => {
  //       if (r.prev.record !== INIT) {
  //         const prevValue: any = r.prev.record.data[field];
  //         const ctx = Snapshot.write();
  //         const t: Record = ctx.write(h, field, prevValue);
  //         if (t.snapshot === ctx) {
  //           t.data[field] = prevValue;
  //           const v: any = t.prev.record.data[field];
  //           Record.markChanged(t, field, v !== prevValue, prevValue);
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
        while (i < p.length && p[i].applied) {
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
    this.changeset.forEach((r: Record, h: Handle) => {
      if (Dbg.isOn && Dbg.trace.gc && r.prev.record !== NIL) Dbg.log(' ', '  ', `${Hints.record(r.prev.record)} is ready for GC because overwritten by ${Hints.record(r)}`)
      r.prev.record = NIL // unlink history
    })
  }

  static _init(): void {
    NIL_SNAPSHOT.acquire(NIL_SNAPSHOT)
    NIL_SNAPSHOT.apply()
    NIL_SNAPSHOT.collect()
    Snapshot.lastId = 100
    Snapshot.headStamp = 101
    Snapshot.oldest = undefined
  }
}

// Hints

export class Hints {
  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const h = Utils.get<Handle>(obj, SYM_HANDLE)
      if (h)
        h.hint = hint
    }
    return obj
  }

  static getHint(obj: object): string | undefined {
    const h = Utils.get<Handle>(obj, SYM_HANDLE)
    return h ? h.hint : undefined
  }

  static handle(h: Handle | undefined, field?: FieldKey | undefined, stamp?: number, tran?: number, typeless?: boolean): string {
    const obj = (h === undefined)
      ? 'blank'
      : (typeless
        ? (stamp === undefined ? `#${h.id}` : `v${stamp}t${tran}#${h.id}`)
        : (stamp === undefined ? `#${h.id} ${h.hint}` : `v${stamp}t${tran}#${h.id} ${h.hint}`))
    return field !== undefined ? `${obj}.${field.toString()}` : obj
  }

  static record(r: Record, field?: FieldKey, typeless?: boolean): string {
    const h = Utils.get<Handle | undefined>(r.data, SYM_HANDLE)
    return Hints.handle(h, field, r.snapshot.timestamp, r.snapshot.id, typeless)
  }

  static conflicts(conflicts: Record[]): string {
    return conflicts.map(ours => {
      const items: string[] = []
      ours.conflicts.forEach((theirs: Record, field: FieldKey) => {
        items.push(Hints.conflictingFieldHint(field, ours, theirs))
      })
      return items.join(', ')
    }).join(', ')
  }

  static conflictingFieldHint(field: FieldKey, ours: Record, theirs: Record): string {
    return Hints.record(theirs, field)
  }
}

const NIL_SNAPSHOT = new Snapshot('<nil>', undefined)
export const NIL = new Record(NIL_SNAPSHOT, undefined, {})
NIL.freeze()
