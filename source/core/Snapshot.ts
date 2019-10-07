// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg, misuse } from './Dbg'
import { Utils, undef } from './Utils'
import { Record, PropKey, ISnapshot, ICacheResult, R_UNMOUNT } from './Record'
import { Handle, R_HANDLE } from './Handle'
import { CopyOnWriteProxy } from './Hooks'

const UNDEFINED_TIMESTAMP = Number.MAX_SAFE_INTEGER - 1

// Snapshot

export class Snapshot implements ISnapshot {
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
  readonly triggers: ICacheResult[]
  private applied: boolean

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

  /* istanbul ignore next */
  static readable = function(): Snapshot {
    return undef() // to be redefined by Transaction implementation
  }

  /* istanbul ignore next */
  static writable = function(): Snapshot {
    return undef() // to be redefined by Transaction implementation
  }

  /* istanbul ignore next */
  static isConflicting = function(oldValue: any, newValue: any): boolean {
    return oldValue !== newValue // to be redefined by Cache implementation
  }

  read(h: Handle): Record {
    const r = this.tryRead(h)
    if (r === Record.blank) /* istanbul ignore next */
      throw misuse(`object ${Hint.handle(h)} doesn't exist in snapshot v${this.stamp}`)
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
      while (r !== Record.blank && r.snapshot.timestamp > this.timestamp)
        r = r.prev.record
    }
    return r
  }

  write(h: Handle, prop: PropKey, value: any, token?: any): Record {
    let r: Record = this.tryRead(h)
    this.guard(h, r, prop, value, token)
    if (r.snapshot !== this) {
      const data = {...r.data}
      Reflect.set(data, R_HANDLE, h)
      r = new Record(h.head, this, data)
      this.changeset.set(h, r)
      h.changing = r
      h.writers++
    }
    return r
  }

  private guard(h: Handle, r: Record, prop: PropKey, value: any, token: any): void {
    if (this.applied)
      throw misuse(`stateful property ${Hint.handle(h, prop)} can only be modified inside transaction`)
    if (r.snapshot !== this && value !== R_HANDLE && this.caching !== undefined && token !== this.caching)
      throw misuse(`cache must have no side effects: ${this.hint} should not change ${Hint.record(r, prop)}`)
    if (r === Record.blank && value !== R_HANDLE) /* istanbul ignore next */
      throw misuse(`object ${Hint.record(r, prop)} doesn't exist in snapshot v${this.stamp}`)
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
          if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(r)} is merged with ${Hint.record(h.head)} among ${merged} properties with ${r.conflicts.size} conflicts.`)
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
      ours.changes.forEach(prop => {
        counter++
        merged[prop] = ours.data[prop]
        if (unmounted || prop === R_UNMOUNT) {
          if (unmounted !== (prop === R_UNMOUNT)) {
            if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(ours, prop)} <> ${Hint.record(head, prop)}.`)
            ours.conflicts.set(prop, head)
          }
        }
        else {
          const conflict = Snapshot.isConflicting(head.data[prop], ours.prev.record.data[prop])
          if (conflict)
            ours.conflicts.set(prop, head)
          if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(ours, prop)} ${conflict ? "<>" : "=="} ${Hint.record(head, prop)}.`)
        }
      })
      Utils.copyAllProps(merged, ours.data) // overwrite with merged copy
      ours.prev.record = head // rebase is completed
    }
    return counter
  }

  apply(error?: any): void {
    this.applied = true
    this.changeset.forEach((r: Record, h: Handle) => {
      r.changes.forEach(prop => CopyOnWriteProxy.seal(r.data[prop], h.proxy, prop))
      r.freeze()
      h.writers--
      if (h.writers === 0)
        h.changing = undefined
      if (!error) {
        h.head = r
        if (Dbg.isOn && Dbg.trace.changes) {
          const props: string[] = []
          r.changes.forEach(prop => props.push(prop.toString()))
          const s = props.join(", ")
          Dbg.log("║", "•", `${Hint.record(r)}(${s}) is applied on top of ${Hint.record(r.prev.record)}.`)
        }
      }
    })
    if (Dbg.isOn && Dbg.trace.transactions)
      Dbg.log(this.stamp < UNDEFINED_TIMESTAMP ? "╚══" : /* istanbul ignore next */ "═══", `v${this.stamp}`, `${this.hint} - ${error ? "CANCEL" : "COMMIT"}(${this.changeset.size})${error ? ` - ${error}` : ``}`)
    Snapshot.applyAllDependencies(this, error)
  }

  static applyAllDependencies = function(snapshot: Snapshot, error?: any): void {
    // to be redefined by Cache implementation
  }

  archive(): void {
    this.triggerGarbageCollection()
    Utils.freezeMap(this.changeset)
    Object.freeze(this.triggers)
    Object.freeze(this)
  }

  // static undo(s: Snapshot): void {
  //   s.changeset.forEach((r: Record, h: Handle) => {
  //     r.changes.forEach(prop => {
  //       if (r.prev.record !== Record.blank) {
  //         const prevValue: any = r.prev.record.data[prop];
  //         const ctx = Snapshot.write();
  //         const t: Record = ctx.write(h, prop, prevValue);
  //         if (t.snapshot === ctx) {
  //           t.data[prop] = prevValue;
  //           const v: any = t.prev.record.data[prop];
  //           Record.markChanged(t, prop, v !== prevValue, prevValue);
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
    if (Dbg.isOn && Dbg.trace.gc) Dbg.log("", "GC", `v${this.stamp}t${this.id} (${this.hint}) snapshot is the oldest one now`)
    this.changeset.forEach((r: Record, h: Handle) => {
      if (Dbg.isOn && Dbg.trace.gc && r.prev.record !== Record.blank) Dbg.log("", " g", `v${this.stamp}t${this.id}: ${Hint.record(r.prev.record)} is ready for GC because overwritten by ${Hint.record(r)}`)
      r.prev.record = Record.blank // unlink history
    })
  }
}

export class Hint {
  static handle(h: Handle | undefined, prop?: PropKey | undefined, stamp?: number, tran?: number, typeless?: boolean): string {
    const obj = h === undefined
      ? "blank"
      : (typeless
        ? (stamp === undefined ? `#${h.id}` : `v${stamp}t${tran}#${h.id}`)
        : (stamp === undefined ? `#${h.id} ${h.hint}` : `v${stamp}t${tran}#${h.id} ${h.hint}`))
    return prop !== undefined ? `${obj}.${prop.toString()}` : obj
  }

  static record(r: Record, prop?: PropKey, typeless?: boolean): string {
    const h = Utils.get<Handle | undefined>(r.data, R_HANDLE)
    return Hint.handle(h, prop, r.snapshot.timestamp, r.snapshot.id, typeless)
  }

  static conflicts(conflicts: Record[]): string {
    return conflicts.map(ours => {
      const items: string[] = []
      ours.conflicts.forEach((theirs: Record, prop: PropKey) => {
        items.push(Hint.conflictProp(prop, ours, theirs))
      })
      return items.join(", ")
    }).join(", ")
  }

  static conflictProp(prop: PropKey, ours: Record, theirs: Record): string {
    return Hint.record(theirs, prop)
  }
}
