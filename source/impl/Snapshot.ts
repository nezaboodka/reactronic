// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Utils, UNDEF } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Sealant } from '../util/Sealant'
import { SealedArray } from '../util/SealedArray'
import { SealedMap } from '../util/SealedMap'
import { SealedSet } from '../util/SealedSet'
import { Kind, SnapshotOptions } from '../Options'
import { AbstractSnapshot, ObjectRevision, MemberName, ObjectHolder, Observable, Observer, Meta, Patch } from './Data'

export const MAX_TIMESTAMP = Number.MAX_SAFE_INTEGER
export const UNDEFINED_TIMESTAMP = MAX_TIMESTAMP - 1

Object.defineProperty(ObjectHolder.prototype, '<snapshot>', {
  configurable: false, enumerable: false,
  get(): any {
    const result: any = {}
    const data = Snapshot.current().getCurrentRevision(this, '<snapshot>').data
    for (const m in data) {
      const v = data[m]
      if (v instanceof Observable)
        result[m] = v.value
      else if (v === Meta.Unobservable)
        result[m] = this.unobservable[m]
      else /* istanbul ignore next */
        result[m] = v
    }
    return result
  },
})

// Snapshot

export class Snapshot implements AbstractSnapshot {
  static idGen: number = -1
  private static stampGen: number = 1
  private static pending: Snapshot[] = []
  private static oldest: Snapshot | undefined = undefined
  static garbageCollectionSummaryInterval: number = Number.MAX_SAFE_INTEGER
  static lastGarbageCollectionSummaryTimestamp: number = Date.now()
  static totalObjectHolderCount: number = 0
  static totalObjectRevisionCount: number = 0

  readonly id: number
  readonly options: SnapshotOptions
  get hint(): string { return this.options.hint ?? 'noname' }
  get timestamp(): number { return this.stamp }
  private stamp: number
  private bumper: number
  readonly changeset: Map<ObjectHolder, ObjectRevision>
  reactions: Observer[]
  phase: number
  sealed: boolean

  constructor(options: SnapshotOptions | null) {
    this.id = ++Snapshot.idGen
    this.options = options ?? DefaultSnapshotOptions
    this.stamp = UNDEFINED_TIMESTAMP
    this.bumper = 100
    this.changeset = new Map<ObjectHolder, ObjectRevision>()
    this.reactions = []
    this.phase = 0
    this.sealed = false
  }

  // To be redefined by transaction implementation
  static current: () => Snapshot = UNDEF
  static edit: () => Snapshot = UNDEF
  static markUsed: (observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, kind: Kind, weak: boolean) => void = UNDEF
  static markEdited: (value: any, edited: boolean, r: ObjectRevision, m: MemberName, h: ObjectHolder) => void = UNDEF
  static isConflicting: (oldValue: any, newValue: any) => boolean = UNDEF
  static propagateAllChangesThroughSubscriptions = (snapshot: Snapshot): void => { /* nop */ }
  static revokeAllSubscriptions = (snapshot: Snapshot): void => { /* nop */ }
  static createPatch: (hint: string, changeset: Map<ObjectHolder, ObjectRevision>) => Patch = UNDEF

  seekRevision(h: ObjectHolder, m: MemberName): ObjectRevision {
    // TODO: Take into account timestamp of the member
    let r: ObjectRevision | undefined = h.editing
    if (r && r.snapshot !== this) {
      r = this.changeset.get(h)
      if (r)
        h.editing = r // remember last changing revision
    }
    if (!r) {
      r = h.head
      while (r !== ROOT_REV && r.snapshot.timestamp > this.timestamp)
        r = r.prev.revision
    }
    return r
  }

  getCurrentRevision(h: ObjectHolder, m: MemberName): ObjectRevision {
    const r = this.seekRevision(h, m)
    if (r === ROOT_REV)
      throw misuse(`object ${Dump.obj(h)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    return r
  }

  getEditableRevision(h: ObjectHolder, m: MemberName, value: any, token?: any): ObjectRevision {
    let r: ObjectRevision = this.seekRevision(h, m)
    const existing = r.data[m]
    if (existing !== Meta.Unobservable) {
      this.checkIfEditable(h, r, m, existing, value, token)
      if (r.snapshot !== this) {
        this.bumpBy(r.snapshot.timestamp)
        const data = { ...m === Meta.Holder ? value : r.data }
        Reflect.set(data, Meta.Holder, h)
        r = new ObjectRevision(this, r, data)
        this.changeset.set(h, r)
        h.editing = r
        h.editors++
      }
    }
    else
      r = ROOT_REV
    return r
  }

  static takeSnapshot<T>(obj: T): T {
    return (obj as any)[Meta.Holder]['<snapshot>']
  }

  static dispose(obj: any): void {
    const ctx = Snapshot.edit()
    const h = Meta.get<ObjectHolder | undefined>(obj, Meta.Holder)
    if (h)
      Snapshot.doDispose(ctx, h)
  }

  static doDispose(ctx: Snapshot, h: ObjectHolder): ObjectRevision {
    const r: ObjectRevision = ctx.getEditableRevision(h, Meta.Disposed, Meta.Disposed)
    if (r !== ROOT_REV) {
      r.data[Meta.Disposed] = Meta.Disposed
      Snapshot.markEdited(Meta.Disposed, true, r, Meta.Disposed, h)
    }
    return r
  }

  private checkIfEditable(h: ObjectHolder, r: ObjectRevision, m: MemberName, existing: any, value: any, token: any): void {
    if (this.sealed)
      throw misuse(`observable property ${Dump.obj(h, m)} can only be modified inside transaction`)
    // if (m !== Sym.Holder && value !== Sym.Holder && this.token !== undefined && token !== this.token && (r.snapshot !== this || r.prev.revision !== ROOT_REV))
    //   throw misuse(`method must have no side effects: ${this.hint} should not change ${Hints.revision(r, m)}`)
    // if (r === ROOT_REV && m !== Sym.Holder && value !== Sym.Holder) /* istanbul ignore next */
    //   throw misuse(`member ${Hints.revision(r, m)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    if (m !== Meta.Holder && value !== Meta.Holder) {
      if (r.snapshot !== this || r.prev.revision !== ROOT_REV) {
        if (this.options.token !== undefined && token !== this.options.token)
          throw misuse(`${this.hint} should not have side effects (trying to change ${Dump.rev(r, m)})`)
        // TODO: Detect uninitialized members
        // if (existing === undefined)
        //   throw misuse(`uninitialized member is detected: ${Hints.revision(r, m)}`)
      }
      if (r === ROOT_REV)
        throw misuse(`member ${Dump.rev(r, m)} doesn't exist in snapshot v${this.stamp} (${this.hint})`)
    }
  }

  acquire(outer: Snapshot): void {
    if (!this.sealed && this.stamp === UNDEFINED_TIMESTAMP) {
      const ahead = this.options.token === undefined || outer.stamp === UNDEFINED_TIMESTAMP
      this.stamp = ahead ? Snapshot.stampGen : outer.stamp
      Snapshot.pending.push(this)
      if (Snapshot.oldest === undefined)
        Snapshot.oldest = this
      if (Dbg.isOn && Dbg.trace.transaction)
        Dbg.log('╔══', `v${this.stamp}`, `${this.hint}`)
    }
  }

  bumpBy(timestamp: number): void {
    if (timestamp > this.bumper)
      this.bumper = timestamp
  }

  rebase(): ObjectRevision[] | undefined { // return conflicts
    let conflicts: ObjectRevision[] | undefined = undefined
    if (this.changeset.size > 0) {
      this.changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
        if (r.prev.revision !== h.head) {
          const merged = Snapshot.merge(r, h.head)
          if (r.conflicts.size > 0) {
            if (!conflicts)
              conflicts = []
            conflicts.push(r)
          }
          if (Dbg.isOn && Dbg.trace.change)
            Dbg.log('╠╝', '', `${Dump.rev(r)} is merged with ${Dump.rev(h.head)} among ${merged} properties with ${r.conflicts.size} conflicts.`)
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

  private static merge(ours: ObjectRevision, head: ObjectRevision): number {
    let counter: number = 0
    const disposed: boolean = head.changes.has(Meta.Disposed)
    const merged = { ...head.data } // clone
    ours.changes.forEach((phase, m) => {
      counter++
      merged[m] = ours.data[m]
      if (disposed || m === Meta.Disposed) {
        if (disposed !== (m === Meta.Disposed)) {
          if (Dbg.isOn && Dbg.trace.change)
            Dbg.log('║╠', '', `${Dump.rev(ours, m)} <> ${Dump.rev(head, m)}`, 0, ' *** CONFLICT ***')
          ours.conflicts.set(m, head)
        }
      }
      else {
        const conflict = Snapshot.isConflicting(head.data[m], ours.prev.revision.data[m])
        if (conflict)
          ours.conflicts.set(m, head)
        if (Dbg.isOn && Dbg.trace.change)
          Dbg.log('║╠', '', `${Dump.rev(ours, m)} ${conflict ? '<>' : '=='} ${Dump.rev(head, m)}`, 0, conflict ? ' *** CONFLICT ***' : undefined)
      }
    })
    Utils.copyAllMembers(merged, ours.data) // overwrite with merged copy
    ours.prev.revision = head // rebase is completed
    return counter
  }

  applyOrDiscard(error?: any): void {
    this.sealed = true
    this.changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
      Snapshot.sealObjectRevision(h, r)
      h.editors--
      if (h.editors === 0) // уходя гасите свет - последний уходящий убирает за всеми
        h.editing = undefined
      if (!error) {
        // if (this.timestamp < h.head.snapshot.timestamp)
        //   console.log(`!!! timestamp downgrade detected ${h.head.snapshot.timestamp} -> ${this.timestamp} !!!`)
        h.head = r // switch object to a new version
        if (Snapshot.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
          Snapshot.totalObjectRevisionCount++
          if (r.prev.revision === ROOT_REV)
            Snapshot.totalObjectHolderCount++
        }
      }
    })
    if (!error)
      this.options.journal?.remember(
        Snapshot.createPatch(this.hint, this.changeset))
    if (Dbg.isOn) {
      if (Dbg.trace.change) {
        this.changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
          const members: string[] = []
          r.changes.forEach((phase, m) => members.push(m.toString()))
          const s = members.join(', ')
          Dbg.log('║', '√', `${Dump.rev(r)} (${s}) is ${r.prev.revision === ROOT_REV ? 'constructed' : `applied on top of ${Dump.rev(r.prev.revision)}`}`)
        })
      }
      if (Dbg.trace.transaction)
        Dbg.log(this.stamp < UNDEFINED_TIMESTAMP ? '╚══' : /* istanbul ignore next */ '═══', `v${this.stamp}`, `${this.hint} - ${error ? 'CANCEL' : 'APPLY'}(${this.changeset.size})${error ? ` - ${error}` : ''}`)
    }
  }

  static sealObjectRevision(h: ObjectHolder, r: ObjectRevision): void {
    if (!r.changes.has(Meta.Disposed))
      r.changes.forEach((phase, m) => Snapshot.sealObservable(r.data[m], m, h.proxy.constructor.name))
    else
      for (const m in r.prev.revision.data)
        r.data[m] = Meta.Disposed
    if (Dbg.isOn)
      Snapshot.freezeObjectRevision(r)
  }

  static sealObservable(observable: Observable | symbol, m: MemberName, typeName: string): void {
    if (observable instanceof Observable) {
      const value = observable.value
      if (value !== undefined && value !== null) {
        const sealedType = Object.getPrototypeOf(value)[Sealant.SealedType]
        if (sealedType)
          observable.value = Sealant.seal(value, sealedType, typeName, m)
      }
    }
  }

  collectGarbage(): void {
    if (Dbg.isOn) {
      Utils.freezeMap(this.changeset)
      Object.freeze(this.reactions)
      Object.freeze(this)
    }
    this.triggerGarbageCollection()
  }

  static freezeObjectRevision(r: ObjectRevision): ObjectRevision {
    Object.freeze(r.data)
    Utils.freezeMap(r.changes)
    Utils.freezeMap(r.conflicts)
    return r
  }

  private triggerGarbageCollection(): void {
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
          Dbg.log('', '[G]', `Total object/revision count: ${Snapshot.totalObjectHolderCount}/${Snapshot.totalObjectRevisionCount}`)
          Snapshot.lastGarbageCollectionSummaryTimestamp = now
        }
      }
    }
  }

  private unlinkHistory(): void {
    if (Dbg.isOn && Dbg.trace.gc)
      Dbg.log('', '[G]', `Dismiss history below v${this.stamp}t${this.id} (${this.hint})`)
    this.changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
      if (Dbg.isOn && Dbg.trace.gc && r.prev.revision !== ROOT_REV)
        Dbg.log(' ', '  ', `${Dump.rev(r.prev.revision)} is ready for GC because overwritten by ${Dump.rev(r)}`)
      if (Snapshot.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
        if (r.prev.revision !== ROOT_REV) {
          Snapshot.totalObjectRevisionCount--
          // console.log('rec--')
        }
        if (r.changes.has(Meta.Disposed)) {
          Snapshot.totalObjectHolderCount--
          // console.log('obj--')
        }
      }
      r.prev.revision = ROOT_REV // unlink history
    })
  }

  static _init(): void {
    const root = ROOT_REV.snapshot as Snapshot // workaround
    root.acquire(root)
    root.applyOrDiscard()
    root.collectGarbage()
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
  static obj(h: ObjectHolder | undefined, m?: MemberName | undefined, stamp?: number, op?: number, typeless?: boolean): string {
    const member = m !== undefined ? `.${m.toString()}` : ''
    return h === undefined
      ? `root${member}`
      : stamp === undefined ? `${h.hint}${member} #${h.id}` : `${h.hint}${member} #${h.id}t${op}v${stamp}`
  }

  static rev(r: ObjectRevision, m?: MemberName): string {
    const h = Meta.get<ObjectHolder | undefined>(r.data, Meta.Holder)
    return Dump.obj(h, m, r.snapshot.timestamp, r.snapshot.id)
  }

  static conflicts(conflicts: ObjectRevision[]): string {
    return conflicts.map(ours => {
      const items: string[] = []
      ours.conflicts.forEach((theirs: ObjectRevision, m: MemberName) => {
        items.push(Dump.conflictingMemberHint(m, ours, theirs))
      })
      return items.join(', ')
    }).join(', ')
  }

  static conflictingMemberHint(m: MemberName, ours: ObjectRevision, theirs: ObjectRevision): string {
    return `${theirs.snapshot.hint} on ${Dump.rev(theirs, m)}`
  }
}

export const ROOT_REV = new ObjectRevision(new Snapshot({ hint: 'root-rev' }), undefined, {})

export const DefaultSnapshotOptions: SnapshotOptions = Object.freeze({
  hint: 'noname',
  standalone: false,
  journal: undefined,
  trace: undefined,
  token: undefined,
})
