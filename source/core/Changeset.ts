// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2024 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Utils, UNDEF } from "../util/Utils.js"
import { Log, misuse } from "../util/Dbg.js"
import { Sealant } from "../util/Sealant.js"
import { SealedArray } from "../util/SealedArray.js"
import { SealedMap } from "../util/SealedMap.js"
import { SealedSet } from "../util/SealedSet.js"
import { Isolation, Kind, SnapshotOptions } from "../Options.js"
import { AbstractChangeset, ObjectSnapshot, MemberName, ObjectHandle, ValueSnapshot, Observer, Meta } from "./Data.js"

export const MAX_REVISION = Number.MAX_SAFE_INTEGER
export const UNDEFINED_REVISION = MAX_REVISION - 1

Object.defineProperty(ObjectHandle.prototype, "#this#", {
  configurable: false, enumerable: false,
  get(): any {
    const result: any = {}
    const data = Changeset.current().getObjectSnapshot(this, "#this#").data
    for (const m in data) {
      const v = data[m]
      if (v instanceof ValueSnapshot)
        result[m] = v.content
      else if (v === Meta.Raw)
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

export class Changeset implements AbstractChangeset {
  static idGen: number = -1
  private static stampGen: number = 1
  private static pending: Changeset[] = []
  private static oldest: Changeset | undefined = undefined
  static garbageCollectionSummaryInterval: number = Number.MAX_SAFE_INTEGER
  static lastGarbageCollectionSummaryTimestamp: number = Date.now()
  static totalObjectHandleCount: number = 0
  static totalObjectSnapshotCount: number = 0

  readonly id: number
  readonly options: SnapshotOptions
  readonly parent?: Changeset
  get hint(): string { return this.options.hint ?? "noname" }
  get timestamp(): number { return this.revision }
  private revision: number
  private bumper: number
  items: Map<ObjectHandle, ObjectSnapshot>
  obsolete: Observer[]
  sealed: boolean

  constructor(options: SnapshotOptions | null, parent?: Changeset) {
    this.id = ++Changeset.idGen
    this.options = options ?? DefaultSnapshotOptions
    this.parent = parent
    this.revision = UNDEFINED_REVISION
    this.bumper = 100
    this.items = new Map<ObjectHandle, ObjectSnapshot>()
    this.obsolete = []
    this.sealed = false
  }

  // To be redefined by transaction implementation
  static current: () => Changeset = UNDEF
  static edit: () => Changeset = UNDEF
  static markUsed: (observable: ValueSnapshot, os: ObjectSnapshot, m: MemberName, h: ObjectHandle, kind: Kind, weak: boolean) => void = UNDEF
  static markEdited: (oldValue: any, newValue: any, edited: boolean, os: ObjectSnapshot, m: MemberName, h: ObjectHandle) => void = UNDEF
  static isConflicting: (oldValue: any, newValue: any) => boolean = UNDEF
  static propagateAllChangesThroughSubscriptions = (changeset: Changeset): void => { /* nop */ }
  static revokeAllSubscriptions = (changeset: Changeset): void => { /* nop */ }
  static enqueueReactiveFunctionsToRun = (reactive: Array<Observer>): void => { /* nop */ }

  lookupObjectSnapshot(h: ObjectHandle, m: MemberName): ObjectSnapshot {
    // TODO: Take into account timestamp of the member
    let os: ObjectSnapshot | undefined = h.editing
    if (os && os.changeset !== this) {
      os = this.items.get(h)
      if (os)
        h.editing = os // remember last changing snapshot
    }
    if (!os) {
      const p = this.parent
      if (!p) { // if nested transaction
        os = h.committed
        while (os !== EMPTY_SNAPSHOT && os.changeset.timestamp > this.timestamp)
          os = os.former.snapshot
      }
      else
        os = p.lookupObjectSnapshot(h, m)
    }
    return os
  }

  getObjectSnapshot(h: ObjectHandle, m: MemberName): ObjectSnapshot {
    const r = this.lookupObjectSnapshot(h, m)
    if (r === EMPTY_SNAPSHOT)
      throw misuse(`${Dump.obj(h, m)} is not yet available for T${this.id}[${this.hint}] because of uncommitted ${h.editing ? `T${h.editing.changeset.id}[${h.editing.changeset.hint}]` : ""} (last committed T${h.committed.changeset.id}[${h.committed.changeset.hint}])`)
    return r
  }

  getEditableObjectSnapshot(h: ObjectHandle, m: MemberName, value: any, token?: any): ObjectSnapshot {
    let os: ObjectSnapshot = this.lookupObjectSnapshot(h, m)
    const existing = os.data[m]
    if (existing !== Meta.Raw) {
      if (this.isNewSnapshotRequired(h, os, m, existing, value, token)) {
        this.bumpBy(os.changeset.timestamp)
        const revision = m === Meta.Handle ? 1 : os.revision + 1
        const data = { ...m === Meta.Handle ? value : os.data }
        Meta.set(data, Meta.Handle, h)
        Meta.set(data, Meta.Revision, new ValueSnapshot(revision))
        os = new ObjectSnapshot(this, os, data)
        this.items.set(h, os)
        h.editing = os
        h.editors++
        if (Log.isOn && Log.opt.write)
          Log.write("║", " ++", `${Dump.obj(h)} - new snapshot is created (revision ${revision})`)
      }
    }
    else
      os = EMPTY_SNAPSHOT
    return os
  }

  replaceObjectSnapshot(h: ObjectHandle, incoming: ObjectSnapshot): void {
    const existing: ObjectSnapshot = this.lookupObjectSnapshot(h, Meta.Handle)
    if (this.isNewSnapshotRequired(h, existing, Meta.Handle, undefined, undefined, undefined)) {
      this.bumpBy(existing.changeset.timestamp)
      this.items.set(h, incoming)
      h.editing = incoming
      h.editors++
    }
    else
      this.items.set(h, incoming)
    if (Log.isOn && Log.opt.write)
      Log.write("║", " !!", `${Dump.obj(h)} - snapshot is replaced (revision ${incoming.revision})`)
  }

  static takeSnapshot<T>(obj: T): T {
    return (obj as any)[Meta.Handle]["#this#"]
  }

  static dispose(obj: any): void {
    const ctx = Changeset.edit()
    const h = Meta.get<ObjectHandle | undefined>(obj, Meta.Handle)
    if (h !== undefined)
      Changeset.doDispose(ctx, h)
  }

  static doDispose(ctx: Changeset, h: ObjectHandle): ObjectSnapshot {
    const os: ObjectSnapshot = ctx.getEditableObjectSnapshot(h, Meta.Revision, Meta.Undefined)
    if (os !== EMPTY_SNAPSHOT)
      os.disposed = true
    return os
  }

  private isNewSnapshotRequired(h: ObjectHandle, os: ObjectSnapshot, m: MemberName, existing: any, value: any, token: any): boolean {
    if (this.sealed && os.changeset !== EMPTY_SNAPSHOT.changeset)
      throw misuse(`observable property ${Dump.obj(h, m)} can only be modified inside transaction`)
    // if (m !== Meta.Handle && value !== Meta.Handle && this.token !== undefined && token !== this.token && (r.snapshot !== this || r.former.snapshot !== ROOT_REV))
    //   throw misuse(`method must have no side effects: ${this.hint} should not change ${Hints.snapshot(r, m)}`)
    // if (r === ROOT_REV && m !== Meta.Handle && value !== Meta.Handle) /* istanbul ignore next */
    //   throw misuse(`${Hints.snapshot(r, m)} is not yet available for T${this.id}[${this.hint}] because of uncommitted ${h.editing ? `, uncommitted T${h.editing.changeset.id}[${h.editing.changeset.hint}]` : ''} (last committed T${h.head.changeset.id}[${h.head.changeset.hint}])`)
    if (m !== Meta.Handle) {
      if (value !== Meta.Handle) {
        if (os.changeset !== this || os.former.snapshot !== EMPTY_SNAPSHOT) {
          if (this.options.token !== undefined && token !== this.options.token)
            throw misuse(`${this.hint} should not have side effects (trying to change ${Dump.snapshot(os, m)})`)
          // TODO: Detect uninitialized members
          // if (existing === undefined)
          //   throw misuse(`uninitialized member is detected: ${Hints.snapshot(r, m)}`)
        }
      }
      if (os === EMPTY_SNAPSHOT)
        throw misuse(`${Dump.snapshot(os, m)} is not yet available for T${this.id}[${this.hint}] because of uncommitted ${h.editing ? `T${h.editing.changeset.id}[${h.editing.changeset.hint}]` : ""} (last committed T${h.committed.changeset.id}[${h.committed.changeset.hint}])`)
    }
    return os.changeset !== this && !this.sealed
  }

  acquire(outer: Changeset): void {
    if (!this.sealed && this.revision === UNDEFINED_REVISION) {
      const ahead = this.options.token === undefined || outer.revision === UNDEFINED_REVISION
      this.revision = ahead ? Changeset.stampGen : outer.revision
      Changeset.pending.push(this)
      if (Changeset.oldest === undefined)
        Changeset.oldest = this
      if (Log.isOn && Log.opt.transaction)
        Log.write("╔══", `s${this.revision}`, `${this.hint}`)
    }
  }

  bumpBy(timestamp: number): void {
    if (timestamp > this.bumper)
      this.bumper = timestamp
  }

  rebase(): ObjectSnapshot[] | undefined { // return conflicts
    let conflicts: ObjectSnapshot[] | undefined = undefined
    if (this.items.size > 0) {
      this.items.forEach((os: ObjectSnapshot, h: ObjectHandle) => {
        const theirs = this.parent ? this.parent.lookupObjectSnapshot(h, Meta.Handle) : h.committed
        if (os.former.snapshot !== theirs || this.parent) {
          const merged = this.merge(h, os, theirs, false /*, this.parent !== undefined*/)
          if (os.conflicts.size > 0) {
            if (!conflicts)
              conflicts = []
            conflicts.push(os)
          }
          if (Log.isOn && Log.opt.transaction)
            Log.write("╠╝", "", `${Dump.snapshot2(h, os.changeset)} is merged with ${Dump.snapshot2(h, theirs.changeset)} among ${merged} properties with ${os.conflicts.size} conflicts.`)
        }
      })
      if (this.options.token === undefined) {
        if (this.bumper > 100) { // if transaction ever touched existing objects
          this.bumper = this.revision // just for debug and is not needed?
          this.revision = ++Changeset.stampGen
        }
        else
          this.revision = this.bumper + 1
      }
      else {
        // TODO: Downgrading timestamp of whole snapshot is not the right way
        // to put cached value into the past on timeline. The solution is
        // to introduce cache-specific timestamp.
        this.revision = this.bumper // downgrade timestamp of renewed cache
      }
    }
    return conflicts
  }

  private merge(h: ObjectHandle, ours: ObjectSnapshot, theirs: ObjectSnapshot, subscriptions: boolean): number {
    let counter: number = 0
    const theirsDisposed = theirs.disposed
    const oursDisposed = ours.disposed
    const merged = { ...theirs.data } // clone
    ours.changes.forEach((o, m) => {
      counter++
      const ourValueSnapshot = ours.data[m] as ValueSnapshot
      merged[m] = ourValueSnapshot
      if (subscriptions && !theirs.changeset.sealed) {
        const theirValueSnapshot = theirs.data[m] as ValueSnapshot
        const theirObservers = theirValueSnapshot.observers
        if (theirObservers) {
          const ourObservers = ourValueSnapshot.observers
          if (ourObservers)
            theirObservers?.forEach(s => ourObservers.add(s))
          else
            ourValueSnapshot.observers = theirObservers
        }
      }
      if (theirsDisposed || oursDisposed) {
        if (theirsDisposed !== oursDisposed) {
          if (theirsDisposed || this.options.isolation !== Isolation.disjoinForInternalDisposal) {
            if (Log.isOn && Log.opt.change)
              Log.write("║╠", "", `${Dump.snapshot2(h, ours.changeset, m)} <> ${Dump.snapshot2(h, theirs.changeset, m)}`, 0, " *** CONFLICT ***")
            ours.conflicts.set(m, theirs)
          }
        }
      }
      else {
        const conflict = Changeset.isConflicting(theirs.data[m], ours.former.snapshot.data[m])
        if (conflict)
          ours.conflicts.set(m, theirs)
        if (Log.isOn && Log.opt.change)
          Log.write("║╠", "", `${Dump.snapshot2(h, ours.changeset, m)} ${conflict ? "<>" : "=="} ${Dump.snapshot2(h, theirs.changeset, m)}`, 0, conflict ? " *** CONFLICT ***" : undefined)
      }
    })
    Utils.copyAllMembers(merged, ours.data) // overwrite with merged copy
    ours.former.snapshot = theirs // rebase is completed
    return counter
  }

  applyOrDiscard(error?: any): Array<Observer> {
    this.sealed = true
    this.items.forEach((os: ObjectSnapshot, h: ObjectHandle) => {
      if (!this.parent)
        Changeset.sealObjectSnapshot(h, os)
      h.editors--
      if (h.editors === 0) // уходя гасите свет - последний уходящий убирает за всеми
        h.editing = undefined
      if (!error) {
        // if (this.timestamp < h.head.snapshot.timestamp)
        //   console.log(`!!! timestamp downgrade detected ${h.head.snapshot.timestamp} -> ${this.timestamp} !!!`)
        // Switch object to a new version in parent/global snapshot
        if (this.parent)
          this.parent.replaceObjectSnapshot(h, os)
        else
          h.committed = os
        if (Changeset.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
          Changeset.totalObjectSnapshotCount++
          if (os.former.snapshot === EMPTY_SNAPSHOT)
            Changeset.totalObjectHandleCount++
        }
      }
    })
    if (Log.isOn) {
      if (Log.opt.change && !error) {
        this.items.forEach((os: ObjectSnapshot, h: ObjectHandle) => {
          const members: string[] = []
          os.changes.forEach((o, m) => members.push(m.toString()))
          const s = members.join(", ")
          Log.write("║", "√", `${Dump.snapshot2(h, os.changeset)} (${s}) is ${os.former.snapshot === EMPTY_SNAPSHOT ? "constructed" : `applied over #${h.id}t${os.former.snapshot.changeset.id}s${os.former.snapshot.changeset.timestamp}`}`)
        })
      }
      if (Log.opt.transaction)
        Log.write(this.revision < UNDEFINED_REVISION ? "╚══" : /* istanbul ignore next */ "═══", `s${this.revision}`, `${this.hint} - ${error ? "CANCEL" : "APPLY"}(${this.items.size})${error ? ` - ${error}` : ""}`)
    }
    if (!error && !this.parent)
      Changeset.propagateAllChangesThroughSubscriptions(this)
    return this.obsolete
  }

  static sealObjectSnapshot(h: ObjectHandle, os: ObjectSnapshot): void {
    if (!os.disposed)
      os.changes.forEach((o, m) => Changeset.sealValueSnapshot(os.data[m], m, h.proxy.constructor.name))
    else
      for (const m in os.former.snapshot.data)
        os.data[m] = Meta.Undefined
    if (Log.isOn)
      Changeset.freezeObjectSnapshot(os)
  }

  static sealValueSnapshot(o: ValueSnapshot | symbol, m: MemberName, typeName: string): void {
    if (o instanceof ValueSnapshot) {
      const value = o.content
      if (value !== undefined && value !== null) {
        const sealedType = Object.getPrototypeOf(value)[Sealant.SealedType]
        if (sealedType)
          o.content = Sealant.seal(value, sealedType, typeName, m)
      }
    }
  }

  static freezeObjectSnapshot(os: ObjectSnapshot): ObjectSnapshot {
    Object.freeze(os.data)
    Utils.freezeSet(os.changes)
    Utils.freezeMap(os.conflicts)
    return os
  }

  triggerGarbageCollection(): void {
    if (this.revision !== 0) {
      if (this === Changeset.oldest) {
        const p = Changeset.pending
        p.sort((a, b) => a.revision - b.revision)
        let i: number = 0
        while (i < p.length && p[i].sealed) {
          p[i].unlinkHistory()
          i++
        }
        Changeset.pending = p.slice(i)
        Changeset.oldest = Changeset.pending[0] // undefined is OK
        const now = Date.now()
        if (now - Changeset.lastGarbageCollectionSummaryTimestamp > Changeset.garbageCollectionSummaryInterval) {
          Log.write("", "[G]", `Total object/snapshot count: ${Changeset.totalObjectHandleCount}/${Changeset.totalObjectSnapshotCount}`)
          Changeset.lastGarbageCollectionSummaryTimestamp = now
        }
      }
    }
  }

  private unlinkHistory(): void {
    if (Log.isOn && Log.opt.gc)
      Log.write("", "[G]", `Dismiss history below t${this.id}s${this.revision} (${this.hint})`)
    this.items.forEach((os: ObjectSnapshot, h: ObjectHandle) => {
      if (Log.isOn && Log.opt.gc && os.former.snapshot !== EMPTY_SNAPSHOT)
        Log.write(" ", "  ", `${Dump.snapshot2(h, os.former.snapshot.changeset)} is ready for GC because overwritten by ${Dump.snapshot2(h, os.changeset)}`)
      if (Changeset.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
        if (os.former.snapshot !== EMPTY_SNAPSHOT)
          Changeset.totalObjectSnapshotCount--
        if (os.disposed)
          Changeset.totalObjectHandleCount--
      }
      os.former.snapshot = EMPTY_SNAPSHOT // unlink history
    })
    this.items = EMPTY_MAP // release for GC
    this.obsolete = EMPTY_ARRAY // release for GC
    if (Log.isOn)
      Object.freeze(this)
  }

  static _init(): void {
    const boot = EMPTY_SNAPSHOT.changeset as Changeset // workaround
    boot.acquire(boot)
    boot.applyOrDiscard()
    boot.triggerGarbageCollection()
    Changeset.freezeObjectSnapshot(EMPTY_SNAPSHOT)
    Changeset.idGen = 100
    Changeset.stampGen = 101
    Changeset.oldest = undefined
    SealedArray.prototype
    SealedMap.prototype
    SealedSet.prototype
  }
}

// Dump

export class Dump {
  static valueHint = (value: any): string => "???"

  static obj(h: ObjectHandle | undefined, m?: MemberName | undefined, stamp?: number, snapshotId?: number, originSnapshotId?: number, value?: any): string {
    const member = m !== undefined ? `.${m.toString()}` : ""
    let result: string
    if (h !== undefined) {
      const v = value !== undefined && value !== Meta.Undefined ? `[=${Dump.valueHint(value)}]` : ""
      if (stamp === undefined)
        result = `${h.hint}${member}${v} #${h.id}`
      else
        result = `${h.hint}${member}${v} #${h.id}t${snapshotId}s${stamp}${originSnapshotId !== undefined && originSnapshotId !== 0 ? `t${originSnapshotId}` : ""}`
    }
    else
      result = `boot${member}`
    return result
  }

  static snapshot2(h: ObjectHandle, s: AbstractChangeset, m?: MemberName, o?: ValueSnapshot): string {
    return Dump.obj(h, m, s.timestamp, s.id, o?.originSnapshotId, o?.content ?? Meta.Undefined)
  }

  static snapshot(os: ObjectSnapshot, m?: MemberName): string {
    const h = Meta.get<ObjectHandle | undefined>(os.data, Meta.Handle)
    const value = m !== undefined ? os.data[m] as ValueSnapshot : undefined
    return Dump.obj(h, m, os.changeset.timestamp, os.changeset.id, value?.originSnapshotId)
  }

  static conflicts(conflicts: ObjectSnapshot[]): string {
    return conflicts.map(ours => {
      const items: string[] = []
      ours.conflicts.forEach((theirs: ObjectSnapshot, m: MemberName) => {
        items.push(Dump.conflictingMemberHint(m, ours, theirs))
      })
      return items.join(", ")
    }).join(", ")
  }

  static conflictingMemberHint(m: MemberName, ours: ObjectSnapshot, theirs: ObjectSnapshot): string {
    return `${theirs.changeset.hint} (${Dump.snapshot(theirs, m)})`
  }
}

export const EMPTY_SNAPSHOT = new ObjectSnapshot(new Changeset({ hint: "<boot>" }), undefined, {})

export const DefaultSnapshotOptions: SnapshotOptions = Object.freeze({
  hint: "noname",
  isolation: Isolation.joinToCurrentTransaction,
  journal: undefined,
  logging: undefined,
  token: undefined,
})
