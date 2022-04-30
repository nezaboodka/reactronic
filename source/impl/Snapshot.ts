// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Utils, UNDEF } from '../util/Utils'
import { Log, misuse } from '../util/Dbg'
import { Sealant } from '../util/Sealant'
import { SealedArray } from '../util/SealedArray'
import { SealedMap } from '../util/SealedMap'
import { SealedSet } from '../util/SealedSet'
import { Kind, SnapshotOptions } from '../Options'
import { AbstractSnapshot, DataRevision, MemberName, DataHolder, Subscription, Subscriber, Meta } from './Data'

export const MAX_TIMESTAMP = Number.MAX_SAFE_INTEGER
export const UNDEFINED_TIMESTAMP = MAX_TIMESTAMP - 1

Object.defineProperty(DataHolder.prototype, '#this', {
  configurable: false, enumerable: false,
  get(): any {
    const result: any = {}
    const data = Snapshot.current().getCurrentRevision(this, '#this').data
    for (const m in data) {
      const v = data[m]
      if (v instanceof Subscription)
        result[m] = v.content
      else if (v === Meta.Nonreactive)
        result[m] = this.data[m]
      else /* istanbul ignore next */
        result[m] = v
    }
    return result
  },
})

// Snapshot

const EMPTY_ARRAY: Array<any> = Object.freeze([]) as any
const EMPTY_MAP: Map<any, any> = Utils.freezeMap(new Map<any, any>()) as any

export class Snapshot implements AbstractSnapshot {
  static idGen: number = -1
  private static stampGen: number = 1
  private static pending: Snapshot[] = []
  private static oldest: Snapshot | undefined = undefined
  static garbageCollectionSummaryInterval: number = Number.MAX_SAFE_INTEGER
  static lastGarbageCollectionSummaryTimestamp: number = Date.now()
  static totalHolderCount: number = 0
  static totalRevisionCount: number = 0

  readonly id: number
  readonly options: SnapshotOptions
  get hint(): string { return this.options.hint ?? 'noname' }
  get timestamp(): number { return this.stamp }
  private stamp: number
  private bumper: number
  changeset: Map<DataHolder, DataRevision>
  reactions: Subscriber[]
  sealed: boolean

  constructor(options: SnapshotOptions | null) {
    this.id = ++Snapshot.idGen
    this.options = options ?? DefaultSnapshotOptions
    this.stamp = UNDEFINED_TIMESTAMP
    this.bumper = 100
    this.changeset = new Map<DataHolder, DataRevision>()
    this.reactions = []
    this.sealed = false
  }

  // To be redefined by transaction implementation
  static current: () => Snapshot = UNDEF
  static edit: () => Snapshot = UNDEF
  static markUsed: (subscription: Subscription, r: DataRevision, m: MemberName, h: DataHolder, kind: Kind, weak: boolean) => void = UNDEF
  static markEdited: (oldValue: any, newValue: any, edited: boolean, r: DataRevision, m: MemberName, h: DataHolder) => void = UNDEF
  static isConflicting: (oldValue: any, newValue: any) => boolean = UNDEF
  static propagateAllChangesThroughSubscriptions = (snapshot: Snapshot): void => { /* nop */ }
  static revokeAllSubscriptions = (snapshot: Snapshot): void => { /* nop */ }
  static enqueueReactionsToRun = (reactions: Array<Subscriber>): void => { /* nop */ }

  seekRevision(h: DataHolder, m: MemberName): DataRevision {
    // TODO: Take into account timestamp of the member
    let r: DataRevision | undefined = h.editing
    if (r && r.snapshot !== this) {
      r = this.changeset.get(h)
      if (r)
        h.editing = r // remember last changing revision
    }
    if (!r) {
      r = h.head
      while (r !== ROOT_REV && r.snapshot.timestamp > this.timestamp)
        r = r.former.revision
    }
    return r
  }

  getCurrentRevision(h: DataHolder, m: MemberName): DataRevision {
    const r = this.seekRevision(h, m)
    if (r === ROOT_REV)
      throw misuse(`object ${Dump.obj(h)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    return r
  }

  getEditableRevision(h: DataHolder, m: MemberName, value: any, token?: any): DataRevision {
    let r: DataRevision = this.seekRevision(h, m)
    const existing = r.data[m]
    if (existing !== Meta.Nonreactive) {
      if (this.isNewRevisionRequired(h, r, m, existing, value, token)) {
        const data = { ...m === Meta.Holder ? value : r.data }
        Reflect.set(data, Meta.Holder, h)
        r = new DataRevision(this, r, data)
        this.changeset.set(h, r)
        h.editing = r
        h.editors++
        if (Log.isOn && Log.opt.write)
          Log.write('║', '  ⎘', `${Dump.obj(h)} - new revision is created`)
      }
    }
    else
      r = ROOT_REV
    return r
  }

  static takeSnapshot<T>(obj: T): T {
    return (obj as any)[Meta.Holder]['#this']
  }

  static dispose(obj: any): void {
    const ctx = Snapshot.edit()
    const h = Meta.get<DataHolder | undefined>(obj, Meta.Holder)
    if (h !== undefined)
      Snapshot.doDispose(ctx, h)
  }

  static doDispose(ctx: Snapshot, h: DataHolder): DataRevision {
    const r: DataRevision = ctx.getEditableRevision(h, Meta.Disposed, Meta.Disposed)
    if (r !== ROOT_REV) {
      r.data[Meta.Disposed] = Meta.Disposed
      Snapshot.markEdited(Meta.Disposed, Meta.Disposed, true, r, Meta.Disposed, h)
    }
    return r
  }

  private isNewRevisionRequired(h: DataHolder, r: DataRevision, m: MemberName, existing: any, value: any, token: any): boolean {
    if (this.sealed && r.snapshot !== ROOT_REV.snapshot)
      throw misuse(`reactive property ${Dump.obj(h, m)} can only be modified inside transaction`)
    // if (m !== Sym.Holder && value !== Sym.Holder && this.token !== undefined && token !== this.token && (r.snapshot !== this || r.former.revision !== ROOT_REV))
    //   throw misuse(`method must have no side effects: ${this.hint} should not change ${Hints.revision(r, m)}`)
    // if (r === ROOT_REV && m !== Sym.Holder && value !== Sym.Holder) /* istanbul ignore next */
    //   throw misuse(`member ${Hints.revision(r, m)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    if (m !== Meta.Holder && value !== Meta.Holder) {
      if (r.snapshot !== this || r.former.revision !== ROOT_REV) {
        if (this.options.token !== undefined && token !== this.options.token)
          throw misuse(`${this.hint} should not have side effects (trying to change ${Dump.rev(r, m)})`)
        // TODO: Detect uninitialized members
        // if (existing === undefined)
        //   throw misuse(`uninitialized member is detected: ${Hints.revision(r, m)}`)
      }
      if (r === ROOT_REV)
        throw misuse(`member ${Dump.rev(r, m)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    }
    return r.snapshot !== this && !this.sealed
  }

  acquire(outer: Snapshot): void {
    if (!this.sealed && this.stamp === UNDEFINED_TIMESTAMP) {
      const ahead = this.options.token === undefined || outer.stamp === UNDEFINED_TIMESTAMP
      this.stamp = ahead ? Snapshot.stampGen : outer.stamp
      Snapshot.pending.push(this)
      if (Snapshot.oldest === undefined)
        Snapshot.oldest = this
      if (Log.isOn && Log.opt.transaction)
        Log.write('╔══', `v${this.stamp}`, `${this.hint}`)
    }
  }

  bumpBy(timestamp: number): void {
    if (timestamp > this.bumper)
      this.bumper = timestamp
  }

  rebase(): DataRevision[] | undefined { // return conflicts
    let conflicts: DataRevision[] | undefined = undefined
    if (this.changeset.size > 0) {
      this.changeset.forEach((r: DataRevision, h: DataHolder) => {
        if (r.former.revision !== h.head) {
          const merged = this.merge(h, r)
          if (r.conflicts.size > 0) {
            if (!conflicts)
              conflicts = []
            conflicts.push(r)
          }
          if (Log.isOn && Log.opt.transaction)
            Log.write('╠╝', '', `${Dump.rev2(h, r.snapshot)} is merged with ${Dump.rev2(h, h.head.snapshot)} among ${merged} properties with ${r.conflicts.size} conflicts.`)
        }
      })
      if (this.options.token === undefined) {
        if (this.bumper > 100) { // if transaction ever touched existing objects
          this.bumper = this.stamp // just for debug and is not needed?
          this.stamp = ++Snapshot.stampGen
        }
        else
          this.stamp = this.bumper + 1
      }
      else {
        // TODO: Downgrading timestamp of whole revision is not the right way
        // to put cached value into the past on timeline. The solution is
        // to introduce cache-specific timestamp.
        this.stamp = this.bumper // downgrade timestamp of renewed cache
      }
    }
    return conflicts
  }

  private merge(h: DataHolder, ours: DataRevision): number {
    let counter: number = 0
    const head = h.head
    const headDisposed: boolean = head.changes.has(Meta.Disposed)
    const merged = { ...head.data } // clone
    ours.changes.forEach((o, m) => {
      counter++
      merged[m] = ours.data[m]
      if (headDisposed || m === Meta.Disposed) {
        if (headDisposed !== (m === Meta.Disposed)) {
          if (headDisposed || this.options.standalone !== 'disposal') {
            if (Log.isOn && Log.opt.change)
              Log.write('║╠', '', `${Dump.rev2(h, ours.snapshot, m)} <> ${Dump.rev2(h, head.snapshot, m)}`, 0, ' *** CONFLICT ***')
            ours.conflicts.set(m, head)
          }
        }
      }
      else {
        const conflict = Snapshot.isConflicting(head.data[m], ours.former.revision.data[m])
        if (conflict)
          ours.conflicts.set(m, head)
        if (Log.isOn && Log.opt.change)
          Log.write('║╠', '', `${Dump.rev2(h, ours.snapshot, m)} ${conflict ? '<>' : '=='} ${Dump.rev2(h, head.snapshot, m)}`, 0, conflict ? ' *** CONFLICT ***' : undefined)
      }
    })
    Utils.copyAllMembers(merged, ours.data) // overwrite with merged copy
    ours.former.revision = head // rebase is completed
    return counter
  }

  applyOrDiscard(error?: any): Array<Subscriber> {
    this.sealed = true
    this.changeset.forEach((r: DataRevision, h: DataHolder) => {
      Snapshot.sealObjectRevision(h, r)
      h.editors--
      if (h.editors === 0) // уходя гасите свет - последний уходящий убирает за всеми
        h.editing = undefined
      if (!error) {
        // if (this.timestamp < h.head.snapshot.timestamp)
        //   console.log(`!!! timestamp downgrade detected ${h.head.snapshot.timestamp} -> ${this.timestamp} !!!`)
        h.head = r // switch object to a new version
        if (Snapshot.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
          Snapshot.totalRevisionCount++
          if (r.former.revision === ROOT_REV)
            Snapshot.totalHolderCount++
        }
      }
    })
    if (Log.isOn) {
      if (Log.opt.change && !error) {
        this.changeset.forEach((r: DataRevision, h: DataHolder) => {
          const members: string[] = []
          r.changes.forEach((o, m) => members.push(m.toString()))
          const s = members.join(', ')
          Log.write('║', '√', `${Dump.rev2(h, r.snapshot)} (${s}) is ${r.former.revision === ROOT_REV ? 'constructed' : `applied on top of ${Dump.rev2(h, r.former.revision.snapshot)}`}`)
        })
      }
      if (Log.opt.transaction)
        Log.write(this.stamp < UNDEFINED_TIMESTAMP ? '╚══' : /* istanbul ignore next */ '═══', `v${this.stamp}`, `${this.hint} - ${error ? 'CANCEL' : 'APPLY'}(${this.changeset.size})${error ? ` - ${error}` : ''}`)
    }
    if (!error)
      Snapshot.propagateAllChangesThroughSubscriptions(this)
    return this.reactions
  }

  static sealObjectRevision(h: DataHolder, r: DataRevision): void {
    if (!r.changes.has(Meta.Disposed))
      r.changes.forEach((o, m) => Snapshot.sealSubscription(r.data[m], m, h.proxy.constructor.name))
    else
      for (const m in r.former.revision.data)
        r.data[m] = Meta.Disposed
    if (Log.isOn)
      Snapshot.freezeObjectRevision(r)
  }

  static sealSubscription(subscription: Subscription | symbol, m: MemberName, typeName: string): void {
    if (subscription instanceof Subscription) {
      const value = subscription.content
      if (value !== undefined && value !== null) {
        const sealedType = Object.getPrototypeOf(value)[Sealant.SealedType]
        if (sealedType)
          subscription.content = Sealant.seal(value, sealedType, typeName, m)
      }
    }
  }

  static freezeObjectRevision(r: DataRevision): DataRevision {
    Object.freeze(r.data)
    Utils.freezeSet(r.changes)
    Utils.freezeMap(r.conflicts)
    return r
  }

  triggerGarbageCollection(): void {
    if (this.stamp !== 0) {
      if (this === Snapshot.oldest) {
        const p = Snapshot.pending
        p.sort((a, b) => a.stamp - b.stamp)
        let i: number = 0
        while (i < p.length && p[i].sealed) {
          p[i].unlinkHistory()
          i++
        }
        Snapshot.pending = p.slice(i)
        Snapshot.oldest = Snapshot.pending[0] // undefined is OK
        const now = Date.now()
        if (now - Snapshot.lastGarbageCollectionSummaryTimestamp > Snapshot.garbageCollectionSummaryInterval) {
          Log.write('', '[G]', `Total object/revision count: ${Snapshot.totalHolderCount}/${Snapshot.totalRevisionCount}`)
          Snapshot.lastGarbageCollectionSummaryTimestamp = now
        }
      }
    }
  }

  private unlinkHistory(): void {
    if (Log.isOn && Log.opt.gc)
      Log.write('', '[G]', `Dismiss history below v${this.stamp}t${this.id} (${this.hint})`)
    this.changeset.forEach((r: DataRevision, h: DataHolder) => {
      if (Log.isOn && Log.opt.gc && r.former.revision !== ROOT_REV)
        Log.write(' ', '  ', `${Dump.rev2(h, r.former.revision.snapshot)} is ready for GC because overwritten by ${Dump.rev2(h, r.snapshot)}`)
      if (Snapshot.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
        if (r.former.revision !== ROOT_REV)
          Snapshot.totalRevisionCount--
        if (r.changes.has(Meta.Disposed))
          Snapshot.totalHolderCount--
      }
      r.former.revision = ROOT_REV // unlink history
    })
    this.changeset = EMPTY_MAP // release for GC
    this.reactions = EMPTY_ARRAY // release for GC
    if (Log.isOn)
      Object.freeze(this)
  }

  static _init(): void {
    const boot = ROOT_REV.snapshot as Snapshot // workaround
    boot.acquire(boot)
    boot.applyOrDiscard()
    boot.triggerGarbageCollection()
    Snapshot.freezeObjectRevision(ROOT_REV)
    Snapshot.idGen = 100
    Snapshot.stampGen = 101
    Snapshot.oldest = undefined
    SealedArray.prototype
    SealedMap.prototype
    SealedSet.prototype
  }
}

// Dump

export class Dump {
  static valueHint = (value: any, m?: MemberName): string => '???'

  static obj(h: DataHolder | undefined, m?: MemberName | undefined, stamp?: number, snapshotId?: number, originSnapshotId?: number, value?: any): string {
    const member = m !== undefined ? `.${m.toString()}` : ''
    let result: string
    if (h !== undefined) {
      const v = value !== undefined && value !== Meta.Undefined ? `[=${Dump.valueHint(value)}]` : ''
      if (stamp === undefined)
        result = `${h.hint}${member}${v} #${h.id}`
      else
        result = `${h.hint}${member}${v} #${h.id}t${snapshotId}v${stamp}${originSnapshotId !== undefined && originSnapshotId !== 0 ? `t${originSnapshotId}` : ''}`
    }
    else
      result = `boot${member}`
    return result
  }

  static rev2(h: DataHolder, s: AbstractSnapshot, m?: MemberName, o?: Subscription): string {
    return Dump.obj(h, m, s.timestamp, s.id, o?.originSnapshotId, o?.content ?? Meta.Undefined)
  }

  static rev(r: DataRevision, m?: MemberName): string {
    const h = Meta.get<DataHolder | undefined>(r.data, Meta.Holder)
    const value = m !== undefined ? r.data[m] as Subscription : undefined
    return Dump.obj(h, m, r.snapshot.timestamp, r.snapshot.id, value?.originSnapshotId)
  }

  static conflicts(conflicts: DataRevision[]): string {
    return conflicts.map(ours => {
      const items: string[] = []
      ours.conflicts.forEach((theirs: DataRevision, m: MemberName) => {
        items.push(Dump.conflictingMemberHint(m, ours, theirs))
      })
      return items.join(', ')
    }).join(', ')
  }

  static conflictingMemberHint(m: MemberName, ours: DataRevision, theirs: DataRevision): string {
    return `${theirs.snapshot.hint} (${Dump.rev(theirs, m)})`
  }
}

export const ROOT_REV = new DataRevision(new Snapshot({ hint: '<root>' }), undefined, {})

export const DefaultSnapshotOptions: SnapshotOptions = Object.freeze({
  hint: 'noname',
  standalone: false,
  journal: undefined,
  logging: undefined,
  token: undefined,
})
