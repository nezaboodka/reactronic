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
import { AbstractChangeset, ObjectVersion, FieldKey, ObjectHandle, FieldVersion, Observer, Meta } from "./Data.js"

export const MAX_REVISION = Number.MAX_SAFE_INTEGER
export const UNDEFINED_REVISION = MAX_REVISION - 1

Object.defineProperty(ObjectHandle.prototype, "#this#", {
  configurable: false, enumerable: false,
  get(): any {
    const result: any = {}
    const data = Changeset.current().getObjectVersion(this, "#this#").data
    for (const fk in data) {
      const v = data[fk]
      if (v instanceof FieldVersion)
        result[fk] = v.content
      else if (v === Meta.Raw)
        result[fk] = this.data[fk]
      else /* istanbul ignore next */
        result[fk] = v
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
  items: Map<ObjectHandle, ObjectVersion>
  obsolete: Observer[]
  sealed: boolean

  constructor(options: SnapshotOptions | null, parent?: Changeset) {
    this.id = ++Changeset.idGen
    this.options = options ?? DefaultSnapshotOptions
    this.parent = parent
    this.revision = UNDEFINED_REVISION
    this.bumper = 100
    this.items = new Map<ObjectHandle, ObjectVersion>()
    this.obsolete = []
    this.sealed = false
  }

  // To be redefined by transaction implementation
  static current: () => Changeset = UNDEF
  static edit: () => Changeset = UNDEF
  static markUsed: (fv: FieldVersion, ov: ObjectVersion, fk: FieldKey, h: ObjectHandle, kind: Kind, weak: boolean) => void = UNDEF
  static markEdited: (oldValue: any, newValue: any, edited: boolean, ov: ObjectVersion, fk: FieldKey, h: ObjectHandle) => void = UNDEF
  static isConflicting: (oldValue: any, newValue: any) => boolean = UNDEF
  static propagateAllChangesThroughSubscriptions = (changeset: Changeset): void => { /* nop */ }
  static revokeAllSubscriptions = (changeset: Changeset): void => { /* nop */ }
  static enqueueReactiveFunctionsToRun = (reactive: Array<Observer>): void => { /* nop */ }

  lookupObjectVersion(h: ObjectHandle, fk: FieldKey, editing: boolean): ObjectVersion {
    // TODO: Take into account timestamp of the member
    let ov: ObjectVersion | undefined = h.editing
    if (ov && ov.changeset !== this) {
      ov = this.items.get(h)
      if (ov)
        h.editing = ov // remember last changing snapshot
    }
    const parent = this.parent
    if (!ov) {
      if (!parent) { // if nested transaction
        ov = h.applied
        while (ov !== EMPTY_OBJECT_VERSION && ov.changeset.timestamp > this.timestamp)
          ov = ov.former.objectVersion
      }
      else
        ov = parent.lookupObjectVersion(h, fk, editing)
    }
    else if (!editing && parent && !ov.changes.has(fk) && ov.former.objectVersion !== EMPTY_OBJECT_VERSION)
      ov = parent.lookupObjectVersion(h, fk, editing)
    return ov
  }

  getObjectVersion(h: ObjectHandle, fk: FieldKey): ObjectVersion {
    const r = this.lookupObjectVersion(h, fk, false)
    if (r === EMPTY_OBJECT_VERSION)
      throw misuse(`${Dump.obj(h, fk)} is not yet available for T${this.id}[${this.hint}] because ${h.editing ? `T${h.editing.changeset.id}[${h.editing.changeset.hint}]` : ""} is not yet applied (last applied T${h.applied.changeset.id}[${h.applied.changeset.hint}])`)
    return r
  }

  getEditableObjectVersion(h: ObjectHandle, fk: FieldKey, value: any, token?: any): ObjectVersion {
    let ov: ObjectVersion = this.lookupObjectVersion(h, fk, true)
    const existing = ov.data[fk]
    if (existing !== Meta.Raw) {
      if (this.isNewObjectVersionRequired(h, ov, fk, existing, value, token)) {
        this.bumpBy(ov.changeset.timestamp)
        const revision = fk === Meta.Handle ? 1 : ov.revision + 1
        const data = { ...fk === Meta.Handle ? value : ov.data }
        Meta.set(data, Meta.Handle, h)
        Meta.set(data, Meta.Revision, new FieldVersion(revision, this.id))
        ov = new ObjectVersion(this, ov, data)
        this.items.set(h, ov)
        h.editing = ov
        h.editors++
        if (Log.isOn && Log.opt.write)
          Log.write("║", " ++", `${Dump.obj(h)} - new snapshot is created (revision ${revision})`)
      }
    }
    else
      ov = EMPTY_OBJECT_VERSION
    return ov
  }

  setFieldContent(h: ObjectHandle, fk: FieldKey, ov: ObjectVersion, content: any, receiver: any, sensitivity: boolean): void {
    let existing = ov.data[fk] as FieldVersion
    if (existing !== undefined || (ov.former.objectVersion.changeset === EMPTY_OBJECT_VERSION.changeset && (fk in h.data) === false)) {
      if (existing === undefined || existing.content !== content || sensitivity) {
        const existingContent = existing?.content
        if (ov.former.objectVersion.data[fk] === existing) {
          existing = ov.data[fk] = new FieldVersion(content, this.id)
          Changeset.markEdited(existingContent, content, true, ov, fk, h)
        }
        else {
          existing.content = content
          existing.lastEditorChangesetId = this.id
          Changeset.markEdited(existingContent, content, true, ov, fk, h)
        }
      }
    }
    else
      Reflect.set(h.data, fk, content, receiver)
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

  static doDispose(ctx: Changeset, h: ObjectHandle): ObjectVersion {
    const ov: ObjectVersion = ctx.getEditableObjectVersion(h, Meta.Revision, Meta.Undefined)
    if (ov !== EMPTY_OBJECT_VERSION)
      ov.disposed = true
    return ov
  }

  private isNewObjectVersionRequired(h: ObjectHandle, ov: ObjectVersion, fk: FieldKey, existing: any, value: any, token: any): boolean {
    if (this.sealed && ov.changeset !== EMPTY_OBJECT_VERSION.changeset)
      throw misuse(`observable property ${Dump.obj(h, fk)} can only be modified inside transaction`)
    // if (fk !== Meta.Handle && value !== Meta.Handle && this.token !== undefined && token !== this.token && (r.snapshot !== this || r.former.snapshot !== ROOT_REV))
    //   throw misuse(`method must have no side effects: ${this.hint} should not change ${Hints.snapshot(r, fk)}`)
    // if (r === ROOT_REV && fk !== Meta.Handle && value !== Meta.Handle) /* istanbul ignore next */
    //   throw misuse(`${Hints.snapshot(r, fk)} is not yet available for T${this.id}[${this.hint}] because of unfinished ${h.editing ? `, unfinished T${h.editing.changeset.id}[${h.editing.changeset.hint}]` : ''} (last applied T${h.head.changeset.id}[${h.head.changeset.hint}])`)
    if (fk !== Meta.Handle) {
      if (value !== Meta.Handle) {
        if (ov.changeset !== this || ov.former.objectVersion !== EMPTY_OBJECT_VERSION) {
          if (this.options.token !== undefined && token !== this.options.token)
            throw misuse(`${this.hint} should not have side effects (trying to change ${Dump.snapshot(ov, fk)})`)
          // TODO: Detect uninitialized members
          // if (existing === undefined)
          //   throw misuse(`uninitialized member is detected: ${Hints.snapshot(r, fk)}`)
        }
      }
      // if (ov === EMPTY_SNAPSHOT)
      //   throw misuse(`${Dump.snapshot(ov, fk)} is not yet available for T${this.id}[${this.hint}] because ${h.editing ? `T${h.editing.changeset.id}[${h.editing.changeset.hint}]` : ""} is not yet applied (last applied T${h.applied.changeset.id}[${h.applied.changeset.hint}])`)
    }
    return ov.changeset !== this && !this.sealed
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

  rebase(): ObjectVersion[] | undefined { // return conflicts
    let conflicts: ObjectVersion[] | undefined = undefined
    if (this.items.size > 0) {
      this.items.forEach((ov: ObjectVersion, h: ObjectHandle) => {
        const theirs = this.parent ? this.parent.lookupObjectVersion(h, Meta.Handle, false) : h.applied
        if (ov.former.objectVersion !== theirs) {
          const merged = this.merge(h, ov, theirs)
          if (ov.conflicts.size > 0) {
            if (!conflicts)
              conflicts = []
            conflicts.push(ov)
          }
          if (Log.isOn && Log.opt.transaction)
            Log.write("╠╝", "", `${Dump.snapshot2(h, ov.changeset)} is merged with ${Dump.snapshot2(h, theirs.changeset)} among ${merged} properties with ${ov.conflicts.size} conflicts.`)
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

  private merge(h: ObjectHandle, ours: ObjectVersion, theirs: ObjectVersion): number {
    let counter: number = 0
    const theirsDisposed = theirs.disposed
    const oursDisposed = ours.disposed
    const merged = { ...theirs.data } // clone
    ours.changes.forEach((o, fk) => {
      counter++
      const ourFieldVersion = ours.data[fk] as FieldVersion
      merged[fk] = ourFieldVersion
      // if (subscriptions && !theirs.changeset.sealed) {
      //   const theirValueSnapshot = theirs.data[fk] as ValueSnapshot
      //   const theirObservers = theirValueSnapshot.observers
      //   if (theirObservers) {
      //     const ourObservers = ourValueSnapshot.observers
      //     if (ourObservers)
      //       theirObservers?.forEach(s => ourObservers.add(s))
      //     else
      //       ourValueSnapshot.observers = theirObservers
      //   }
      // }
      if (theirsDisposed || oursDisposed) {
        if (theirsDisposed !== oursDisposed) {
          if (theirsDisposed || this.options.isolation !== Isolation.disjoinForInternalDisposal) {
            if (Log.isOn && Log.opt.change)
              Log.write("║╠", "", `${Dump.snapshot2(h, ours.changeset, fk)} <> ${Dump.snapshot2(h, theirs.changeset, fk)}`, 0, " *** CONFLICT ***")
            ours.conflicts.set(fk, theirs)
          }
        }
      }
      else {
        const conflict = Changeset.isConflicting(theirs.data[fk], ours.former.objectVersion.data[fk])
        if (conflict)
          ours.conflicts.set(fk, theirs)
        if (Log.isOn && Log.opt.change)
          Log.write("║╠", "", `${Dump.snapshot2(h, ours.changeset, fk)} ${conflict ? "<>" : "=="} ${Dump.snapshot2(h, theirs.changeset, fk)}`, 0, conflict ? " *** CONFLICT ***" : undefined)
      }
    })
    Utils.copyAllMembers(merged, ours.data) // overwrite with merged copy
    ours.former.objectVersion = theirs // rebase is completed
    return counter
  }

  seal(): void {
    this.sealed = true
  }

  sealObjectVersion(h: ObjectHandle, ov: ObjectVersion): void {
    if (!this.parent) {
      if (!ov.disposed)
        ov.changes.forEach((o, fk) => Changeset.sealFieldVersion(ov.data[fk], fk, h.proxy.constructor.name))
      else
        for (const fk in ov.former.objectVersion.data)
          ov.data[fk] = Meta.Undefined
      if (Log.isOn)
        Changeset.freezeObjectVersion(ov)
    }
    h.editors--
    if (h.editors === 0) // уходя гасите свет - последний уходящий убирает за всеми
      h.editing = undefined
  }

  static sealFieldVersion(fv: FieldVersion | symbol, fk: FieldKey, typeName: string): void {
    if (fv instanceof FieldVersion) {
      const content = fv.content
      if (content !== undefined && content !== null) {
        const sealedType = Object.getPrototypeOf(content)[Sealant.SealedType]
        if (sealedType)
          fv.content = Sealant.seal(content, sealedType, typeName, fk)
      }
    }
  }

  static freezeObjectVersion(ov: ObjectVersion): ObjectVersion {
    Object.freeze(ov.data)
    Utils.freezeSet(ov.changes)
    Utils.freezeMap(ov.conflicts)
    return ov
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
    this.items.forEach((ov: ObjectVersion, h: ObjectHandle) => {
      if (Log.isOn && Log.opt.gc && ov.former.objectVersion !== EMPTY_OBJECT_VERSION)
        Log.write(" ", "  ", `${Dump.snapshot2(h, ov.former.objectVersion.changeset)} is ready for GC because overwritten by ${Dump.snapshot2(h, ov.changeset)}`)
      if (Changeset.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
        if (ov.former.objectVersion !== EMPTY_OBJECT_VERSION)
          Changeset.totalObjectSnapshotCount--
        if (ov.disposed)
          Changeset.totalObjectHandleCount--
      }
      ov.former.objectVersion = EMPTY_OBJECT_VERSION // unlink history
    })
    this.items = EMPTY_MAP // release for GC
    this.obsolete = EMPTY_ARRAY // release for GC
    if (Log.isOn)
      Object.freeze(this)
  }

  static _init(): void {
    const boot = EMPTY_OBJECT_VERSION.changeset as Changeset // workaround
    boot.acquire(boot)
    boot.seal()
    boot.triggerGarbageCollection()
    Changeset.freezeObjectVersion(EMPTY_OBJECT_VERSION)
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

  static obj(h: ObjectHandle | undefined, fk?: FieldKey | undefined, stamp?: number, changesetId?: number, lastEditorChangesetId?: number, value?: any): string {
    const member = fk !== undefined ? `.${fk.toString()}` : ""
    let result: string
    if (h !== undefined) {
      const v = value !== undefined && value !== Meta.Undefined ? `[=${Dump.valueHint(value)}]` : ""
      if (stamp === undefined)
        result = `${h.hint}${member}${v} #${h.id}`
      else
        result = `${h.hint}${member}${v} #${h.id}t${changesetId}s${stamp}${lastEditorChangesetId !== undefined ? `e${lastEditorChangesetId}` : ""}`
    }
    else
      result = `boot${member}`
    return result
  }

  static snapshot2(h: ObjectHandle, s: AbstractChangeset, fk?: FieldKey, o?: FieldVersion): string {
    return Dump.obj(h, fk, s.timestamp, s.id, o?.lastEditorChangesetId, o?.content ?? Meta.Undefined)
  }

  static snapshot(ov: ObjectVersion, fk?: FieldKey): string {
    const h = Meta.get<ObjectHandle | undefined>(ov.data, Meta.Handle)
    const fv = fk !== undefined ? ov.data[fk] as FieldVersion : undefined
    return Dump.obj(h, fk, ov.changeset.timestamp, ov.changeset.id, fv?.lastEditorChangesetId)
  }

  static conflicts(conflicts: ObjectVersion[]): string {
    return conflicts.map(ours => {
      const items: string[] = []
      ours.conflicts.forEach((theirs: ObjectVersion, fk: FieldKey) => {
        items.push(Dump.conflictingMemberHint(fk, ours, theirs))
      })
      return items.join(", ")
    }).join(", ")
  }

  static conflictingMemberHint(fk: FieldKey, ours: ObjectVersion, theirs: ObjectVersion): string {
    return `${theirs.changeset.hint} (${Dump.snapshot(theirs, fk)})`
  }
}

export const EMPTY_OBJECT_VERSION = new ObjectVersion(new Changeset({ hint: "<boot>" }), undefined, {})

export const DefaultSnapshotOptions: SnapshotOptions = Object.freeze({
  hint: "noname",
  isolation: Isolation.joinToCurrentTransaction,
  journal: undefined,
  logging: undefined,
  token: undefined,
})
