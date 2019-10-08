// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg, Utils, misuse, undef } from '../util/all'
import { Context, Record, FieldKey, FieldValue, Handle, Observer, R_HANDLE, R_UNMOUNT } from './Data'
import { Hint } from './Hint'
import { CopyOnWriteProxy } from './Hooks'

const UNDEFINED_TIMESTAMP = Number.MAX_SAFE_INTEGER - 1

// Snapshot

export class Snapshot implements Context {
  static lastId: number = -1
  static headStamp: number = 1
  static pending: Snapshot[] = []
  static oldest: Snapshot | undefined = undefined
  static readonly init: Snapshot = new Snapshot("<init>", undefined)

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

  // To be redefined by Transaction and Cache implementations
  static readable: () => Snapshot = undef
  static writable: () => Snapshot = undef
  static markChanged: (record: Record, field: FieldKey, value: any, changed: boolean) => void = undef
  static markViewed: (record: Record, field: FieldKey, value: FieldValue, weak: boolean) => void = undef
  static isConflicting: (oldValue: any, newValue: any) => boolean = undef
  static applyAllDependencies = (snapshot: Snapshot, error?: any): void => { /* nop */ }

  read(h: Handle): Record {
    const r = this.tryRead(h)
    if (r === BLANK) /* istanbul ignore next */
      throw misuse(`object ${Hint.handle(h)} doesn't exist in snapshot v${this.stamp}`)
    return r
  }

  tryRead(h: Handle): Record {
    let r: Record | undefined = h.changing
    if (r && r.creator !== this) {
      r = this.changeset.get(h)
      if (r)
        h.changing = r // remember last changing record
    }
    if (!r) {
      r = h.head
      while (r !== BLANK && r.creator.timestamp > this.timestamp)
        r = r.prev.record
    }
    return r
  }

  write(h: Handle, field: FieldKey, value: any, token?: any): Record {
    let r: Record = this.tryRead(h)
    this.guard(h, r, field, value, token)
    if (r.creator !== this) {
      const data = {...r.data}
      Reflect.set(data, R_HANDLE, h)
      r = new Record(this, h.head, data)
      this.changeset.set(h, r)
      h.changing = r
      h.writers++
    }
    return r
  }

  private guard(h: Handle, r: Record, field: FieldKey, value: any, token: any): void {
    if (this.applied)
      throw misuse(`stateful property ${Hint.handle(h, field)} can only be modified inside transaction`)
    if (r.creator !== this && value !== R_HANDLE && this.caching !== undefined && token !== this.caching)
      throw misuse(`cache must have no side effects: ${this.hint} should not change ${Hint.record(r, field)}`)
    if (r === BLANK && value !== R_HANDLE) /* istanbul ignore next */
      throw misuse(`object ${Hint.record(r, field)} doesn't exist in snapshot v${this.stamp}`)
  }

  acquire(outer: Snapshot): void {
    if (!this.applied && this.stamp === UNDEFINED_TIMESTAMP) {
      const ahead = this.caching === undefined || outer.stamp === UNDEFINED_TIMESTAMP
      this.stamp = ahead ? Snapshot.headStamp : outer.stamp
      Snapshot.pending.push(this)
      if (Snapshot.oldest === undefined)
        Snapshot.oldest = this
      if (Dbg.isOn && Dbg.trace.transactions) Dbg.log("╔══", `v${this.stamp}`, `${this.hint}`)
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
          if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "≈", `${Hint.record(r)} is merged with ${Hint.record(h.head)} among ${merged} properties with ${r.conflicts.size} conflicts.`)
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
      const unmounted: boolean = head.changes.has(R_UNMOUNT)
      const merged = {...head.data} // clone
      ours.changes.forEach(field => {
        counter++
        merged[field] = ours.data[field]
        if (unmounted || field === R_UNMOUNT) {
          if (unmounted !== (field === R_UNMOUNT)) {
            if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "≈", `${Hint.record(ours, field)} <> ${Hint.record(head, field)}.`)
            ours.conflicts.set(field, head)
          }
        }
        else {
          const conflict = Snapshot.isConflicting(head.data[field], ours.prev.record.data[field])
          if (conflict)
            ours.conflicts.set(field, head)
          if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "≈", `${Hint.record(ours, field)} ${conflict ? "<>" : "=="} ${Hint.record(head, field)}.`)
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
          const s = fields.join(", ")
          Dbg.log("║", "√", `${Hint.record(r)}(${s}) is applied on top of ${Hint.record(r.prev.record)}.`)
        }
      }
    })
    if (Dbg.isOn && Dbg.trace.transactions)
      Dbg.log(this.stamp < UNDEFINED_TIMESTAMP ? "╚══" : /* istanbul ignore next */ "═══", `v${this.stamp}`, `${this.hint} - ${error ? "CANCEL" : "COMMIT"}(${this.changeset.size})${error ? ` - ${error}` : ``}`)
    Snapshot.applyAllDependencies(this, error)
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
  //       if (r.prev.record !== Record.blank) {
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
    if (Dbg.isOn && Dbg.trace.gc) Dbg.log("", " G", `v${this.stamp}t${this.id} (${this.hint}) snapshot is the oldest one now`)
    this.changeset.forEach((r: Record, h: Handle) => {
      if (Dbg.isOn && Dbg.trace.gc && r.prev.record !== BLANK) Dbg.log("", "   g ", `v${this.stamp}t${this.id}: ${Hint.record(r.prev.record)} is ready for GC because overwritten by ${Hint.record(r)}`)
      r.prev.record = BLANK // unlink history
    })
  }

  static _init(): void {
    Snapshot.init.acquire(Snapshot.init)
    Snapshot.init.apply()
    Snapshot.init.collect()
    Snapshot.lastId = 100
    Snapshot.headStamp = 101
    Snapshot.oldest = undefined
  }
}

export const BLANK = new Record(Snapshot.init, undefined, {})
BLANK.freeze()
