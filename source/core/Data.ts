// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Log } from "../util/Dbg.js"
import { Meta } from "./Meta.js"
export { Meta } from "./Meta.js"

// AbstractChangeset

export type AbstractChangeset = {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
  readonly sealed: boolean
}

// FieldVersion

export class FieldVersion<T = any> {
  content: T
  reactions?: Set<Reaction>
  lastEditorChangesetId: number
  get isLaunch(): boolean { return false }
  constructor(content: T, lastEditorChangesetId: number) { this.content = content; this.lastEditorChangesetId = lastEditorChangesetId }
}

// Reaction

export type Reaction = {
  readonly order: number
  readonly triggers: Map<FieldVersion, Subscription> | undefined
  readonly obsoleteSince: number
  hint(nop?: boolean): string
  markObsoleteDueTo(trigger: FieldVersion, fk: FieldKey, changeset: AbstractChangeset, h: ObjectHandle, outer: string, since: number, collector: Array<Reaction>): void
  relaunchIfNotUpToDate(now: boolean, nothrow: boolean): void
}

export type FieldKey = PropertyKey

export type Subscription = {
  readonly memberHint: string
  readonly usageCount: number
}

// ObjectVersion

export class ObjectVersion {
  readonly changeset: AbstractChangeset
  readonly former: { objectVersion: ObjectVersion }
  readonly data: any
  readonly changes: Set<FieldKey>
  readonly conflicts: Map<FieldKey, ObjectVersion>

  constructor(changeset: AbstractChangeset, former: ObjectVersion | undefined, data: object) {
    this.changeset = changeset
    this.former = { objectVersion: former || this } // undefined former means initialization of ROOT_REV
    this.data = data
    this.changes = new Set<FieldKey>()
    this.conflicts = new Map<FieldKey, ObjectVersion>()
    if (Log.isOn)
      Object.freeze(this)
  }

  get revision(): number {
    return (this.data[Meta.Revision] as FieldVersion)?.content ?? 0
  }

  get disposed(): boolean { return this.revision < 0 }
  set disposed(value: boolean) {
    const rev = this.revision
    if (rev < 0 !== value)
      (this.data[Meta.Revision] as FieldVersion).content = ~rev
  }
}

// ObjectHandle

export class ObjectHandle {
  private static generator: number = 19

  readonly id: number
  readonly data: any
  readonly proxy: any
  applied: ObjectVersion
  editing?: ObjectVersion
  editors: number
  hint: string

  constructor(data: any, proxy: any, handler: ProxyHandler<ObjectHandle>, applied: ObjectVersion, hint: string) {
    this.id = ++ObjectHandle.generator
    this.data = data
    this.proxy = proxy || new Proxy<ObjectHandle>(this, handler)
    this.applied = applied
    this.editing = undefined
    this.editors = 0
    this.hint = hint
  }

  static getHint(obj: object, full: boolean): string | undefined {
    const h = Meta.get<ObjectHandle | undefined>(obj, Meta.Handle)
    return h !== undefined ? (full ? `${h.hint}#${h.id}` : h.hint) : /* istanbul ignore next */ undefined
  }
}

// PatchSet & ObjectPatch

export type PatchSet = Map<object, Map<FieldKey, ValuePatch>>

export type ValuePatch = {
  fieldKey: FieldKey
  patchKind: "update" | "add" | "remove"
  freshContent: any
  formerContent: any
}
