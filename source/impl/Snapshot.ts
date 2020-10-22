// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Utils, undef } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Sealant } from '../util/Sealant'
import { SealedArray } from '../util/SealedArray'
import { SealedMap } from '../util/SealedMap'
import { SealedSet } from '../util/SealedSet'
import { Kind, SnapshotOptions } from '../Options'
import { Context, Record, Member, Handle, Observable, Observer, Meta } from './Data'

const UNDEFINED_TIMESTAMP = Number.MAX_SAFE_INTEGER - 1

Object.defineProperty(Handle.prototype, '<snapshot>', {
  configurable: false, enumerable: false,
  get(): any {
    const result: any = {}
    const data = Snapshot.reader().readable(this).data
    for (const m in data) {
      const v = data[m]
      if (v instanceof Observable)
        result[m] = v.value
      else if (v === Meta.Stateless)
        result[m] = this.stateless[m]
      else /* istanbul ignore next */
        result[m] = v
    }
    return result
  },
})

// Snapshot

export class Snapshot implements Context {
  static idGen: number = -1
  static stampGen: number = 1
  static pending: Snapshot[] = []
  static oldest: Snapshot | undefined = undefined
  static garbageCollectionSummaryInterval: number = Number.MAX_SAFE_INTEGER
  static lastGarbageCollectionSummaryTimestamp: number = Date.now()
  static totalObjectCount: number = 0
  static totalRecordCount: number = 0

  readonly id: number
  readonly options: SnapshotOptions
  get hint(): string { return this.options.hint ?? 'noname' }
  get timestamp(): number { return this.stamp }
  private stamp: number
  private bumper: number
  readonly changeset: Map<Handle, Record>
  readonly triggers: Observer[]
  completed: boolean

  constructor(options: SnapshotOptions | null) {
    this.id = ++Snapshot.idGen
    this.options = options ?? DefaultSnapshotOptions
    this.stamp = UNDEFINED_TIMESTAMP
    this.bumper = 100
    this.changeset = new Map<Handle, Record>()
    this.triggers = []
    this.completed = false
  }

  // To be redefined by Transaction and Cache implementations
  static reader: () => Snapshot = undef
  static writer: () => Snapshot = undef
  static markChanged: (r: Record, m: Member, value: any, changed: boolean) => void = undef
  static markViewed: (r: Record, m: Member, value: Observable, kind: Kind, weak: boolean) => void = undef
  static isConflicting: (oldValue: any, newValue: any) => boolean = undef
  static finalizeChangeset = (snapshot: Snapshot, error: Error | undefined): void => { /* nop */ }

  lookup(h: Handle): Record {
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

  readable(h: Handle): Record {
    const r = this.lookup(h)
    if (r === NIL)
      throw misuse(`object ${Hints.obj(h)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    return r
  }

  writable(h: Handle, m: Member, value: any, token?: any): Record {
    let r: Record = this.lookup(h)
    const existing = r.data[m]
    if (existing !== Meta.Stateless) {
      this.guard(h, r, m, existing, value, token)
      if (r.snapshot !== this) {
        const data = {...m === Meta.Handle ? value : r.data}
        Reflect.set(data, Meta.Handle, h)
        r = new Record(this, r, data)
        this.changeset.set(h, r)
        h.changing = r
        h.writers++
      }
    }
    else
      r = NIL
    return r
  }

  static takeSnapshot<T>(obj: T): T {
    return (obj as any)[Meta.Handle]['<snapshot>']
  }

  static dispose(obj: any): void {
    const ctx = Snapshot.writer()
    const h = Meta.get<Handle>(obj, Meta.Handle)
    if (h)
      Snapshot.doDispose(ctx, h)
  }

  static doDispose(ctx: Snapshot, h: Handle): Record {
    const r: Record = ctx.writable(h, Meta.Disposed, Meta.Disposed)
    if (r !== NIL) {
      r.data[Meta.Disposed] = Meta.Disposed
      Snapshot.markChanged(r, Meta.Disposed, Meta.Disposed, true)
    }
    return r
  }

  private guard(h: Handle, r: Record, m: Member, existing: any, value: any, token: any): void {
    if (this.completed)
      throw misuse(`stateful property ${Hints.obj(h, m)} can only be modified inside transactions and triggers`)
    // if (m !== Sym.HANDLE && value !== Sym.HANDLE && this.token !== undefined && token !== this.token && (r.snapshot !== this || r.prev.record !== NIL))
    //   throw misuse(`method must have no side effects: ${this.hint} should not change ${Hints.record(r, m)}`)
    // if (r === NIL && m !== Sym.HANDLE && value !== Sym.HANDLE) /* istanbul ignore next */
    //   throw misuse(`member ${Hints.record(r, m)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    if (m !== Meta.Handle && value !== Meta.Handle) {
      if (r.snapshot !== this || r.prev.record !== NIL) {
        if (this.options.token !== undefined && token !== this.options.token)
          throw misuse(`${this.hint} should not have side effects (trying to change ${Hints.record(r, m)})`)
        // TODO: Detect uninitialized members
        // if (existing === undefined)
        //   throw misuse(`uninitialized member is detected: ${Hints.record(r, m)}`)
      }
      if (r === NIL)
        throw misuse(`member ${Hints.record(r, m)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    }
  }

  acquire(outer: Snapshot): void {
    if (!this.completed && this.stamp === UNDEFINED_TIMESTAMP) {
      const ahead = this.options.token === undefined || outer.stamp === UNDEFINED_TIMESTAMP
      this.stamp = ahead ? Snapshot.stampGen : outer.stamp
      Snapshot.pending.push(this)
      if (Snapshot.oldest === undefined)
        Snapshot.oldest = this
      if (Dbg.isOn && Dbg.trace.transactions)
        Dbg.log('╔══', `v${this.stamp}`, `${this.hint}`)
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
      this.changeset.forEach((r: Record, h: Handle) => {
        if (r.prev.record !== h.head) {
          const merged = Snapshot.merge(r, h.head)
          if (r.conflicts.size > 0) {
            if (!conflicts)
              conflicts = []
            conflicts.push(r)
          }
          if (Dbg.isOn && Dbg.trace.changes)
            Dbg.log('╠╝', '', `${Hints.record(r)} is merged with ${Hints.record(h.head)} among ${merged} properties with ${r.conflicts.size} conflicts.`)
        }
      })
      if (this.options.token === undefined) {
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
    const disposed: boolean = head.changes.has(Meta.Disposed)
    const merged = {...head.data} // clone
    ours.changes.forEach(m => {
      counter++
      merged[m] = ours.data[m]
      if (disposed || m === Meta.Disposed) {
        if (disposed !== (m === Meta.Disposed)) {
          if (Dbg.isOn && Dbg.trace.changes)
            Dbg.log('║╠', '', `${Hints.record(ours, m)} <> ${Hints.record(head, m)}`, 0, ' *** CONFLICT ***')
          ours.conflicts.set(m, head)
        }
      }
      else {
        const conflict = Snapshot.isConflicting(head.data[m], ours.prev.record.data[m])
        if (conflict)
          ours.conflicts.set(m, head)
        if (Dbg.isOn && Dbg.trace.changes)
          Dbg.log('║╠', '', `${Hints.record(ours, m)} ${conflict ? '<>' : '=='} ${Hints.record(head, m)}`, 0, conflict ? ' *** CONFLICT ***' : undefined)
      }
    })
    Utils.copyAllMembers(merged, ours.data) // overwrite with merged copy
    ours.prev.record = head // rebase is completed
    return counter
  }

  complete(error?: any): void {
    this.completed = true
    this.changeset.forEach((r: Record, h: Handle) => {
      r.changes.forEach(m => Snapshot.seal(r.data[m], h.proxy, m))
      h.writers--
      if (h.writers === 0) // уходя гасите свет
        h.changing = undefined
      if (!error) {
        // if (this.timestamp < h.head.snapshot.timestamp)
        //   console.log(`!!! timestamp downgrade detected ${h.head.snapshot.timestamp} -> ${this.timestamp} !!!`)
        h.head = r
        if (Snapshot.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
          Snapshot.totalRecordCount++
          // console.log('rec++')
          if (r.prev.record === NIL) {
            Snapshot.totalObjectCount++
            // console.log('obj++')
          }
        }
        if (Dbg.isOn && Dbg.trace.changes) {
          const members: string[] = []
          r.changes.forEach(m => members.push(m.toString()))
          const s = members.join(', ')
          Dbg.log('║', '√', `${Hints.record(r)} (${s}) is ${r.prev.record === NIL ? 'constructed' : `applied on top of ${Hints.record(r.prev.record)}`}`)
        }
      }
    })
    if (Dbg.isOn && Dbg.trace.transactions)
      Dbg.log(this.stamp < UNDEFINED_TIMESTAMP ? '╚══' : /* istanbul ignore next */ '═══', `v${this.stamp}`, `${this.hint} - ${error ? 'CANCEL' : 'APPLY'}(${this.changeset.size})${error ? ` - ${error}` : ''}`)
    Snapshot.finalizeChangeset(this, error)
  }

  static seal(observable: Observable | symbol, proxy: any, m: Member): void {
    if (observable instanceof Observable) {
      const value = observable.value
      if (value !== undefined && value !== null) {
        const sealType = Object.getPrototypeOf(value)[Sealant.SealType]
        if (sealType)
          observable.value = Sealant.seal(value, proxy, m, sealType)
      }
    }
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
          Dbg.log('', '[G]', `Total object/record count: ${Snapshot.totalObjectCount}/${Snapshot.totalRecordCount}`)
          Snapshot.lastGarbageCollectionSummaryTimestamp = now
        }
      }
    }
  }

  private unlinkHistory(): void {
    if (Dbg.isOn && Dbg.trace.gc)
      Dbg.log('', '[G]', `Dismiss history below v${this.stamp}t${this.id} (${this.hint})`)
    this.changeset.forEach((r: Record, h: Handle) => {
      if (Dbg.isOn && Dbg.trace.gc && r.prev.record !== NIL)
        Dbg.log(' ', '  ', `${Hints.record(r.prev.record)} is ready for GC because overwritten by ${Hints.record(r)}`)
      if (Snapshot.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
        if (r.prev.record !== NIL) {
          Snapshot.totalRecordCount--
          // console.log('rec--')
        }
        if (r.changes.has(Meta.Disposed)) {
          Snapshot.totalObjectCount--
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
    SealedArray.prototype
    SealedMap.prototype
    SealedSet.prototype
  }
}

// Hints

export class Hints {
  static obj(h: Handle | undefined, m?: Member | undefined, stamp?: number, tran?: number, typeless?: boolean): string {
    const member = m !== undefined ? `.${m.toString()}` : ''
    return h === undefined
      ? `nil${member}`
      : stamp === undefined ? `${h.hint}${member} #${h.id}` : `${h.hint}${member} #${h.id}t${tran}v${stamp}`
  }

  static record(r: Record, m?: Member): string {
    const h = Meta.get<Handle | undefined>(r.data, Meta.Handle)
    return Hints.obj(h, m, r.snapshot.timestamp, r.snapshot.id)
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

export const NIL = new Record(new Snapshot({ hint: '<nil>' }), undefined, {})

export const DefaultSnapshotOptions: SnapshotOptions = Object.freeze({
  hint: 'noname',
  spawn: false,
  journal: undefined,
  trace: undefined,
  token: undefined,
})
