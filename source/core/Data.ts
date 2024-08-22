// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2024 Nezaboodka Software <contact@nezaboodka.by>
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

// ValueSnapshot & Observer

export class ValueSnapshot<T = any> {
  content: T
  observers?: Set<Observer>
  get isLaunch(): boolean { return false }
  get originSnapshotId(): number | undefined { return 0 }
  constructor(content: T) { this.content = content }
}

export type Observer = {
  readonly order: number
  readonly observables: Map<ValueSnapshot, Subscription> | undefined
  readonly obsoleteSince: number
  hint(nop?: boolean): string
  markObsoleteDueTo(observable: ValueSnapshot, m: MemberName, changeset: AbstractChangeset, h: ObjectHandle, outer: string, since: number, reactive: Array<Observer>): void
  relaunchIfNotUpToDate(now: boolean, nothrow: boolean): void
}

export type MemberName = PropertyKey

export type Subscription = {
  readonly memberHint: string
  readonly usageCount: number
}

// ObjectSnapshot

export class ObjectSnapshot {
  readonly changeset: AbstractChangeset
  readonly former: { snapshot: ObjectSnapshot }
  readonly data: any
  readonly changes: Set<MemberName>
  readonly conflicts: Map<MemberName, ObjectSnapshot>

  constructor(changeset: AbstractChangeset, former: ObjectSnapshot | undefined, data: object) {
    this.changeset = changeset
    this.former = { snapshot: former || this } // undefined former means initialization of ROOT_REV
    this.data = data
    this.changes = new Set<MemberName>()
    this.conflicts = new Map<MemberName, ObjectSnapshot>()
    if (Log.isOn)
      Object.freeze(this)
  }

  get revision(): number {
    return (this.data[Meta.Revision] as ValueSnapshot)?.content ?? 0
  }

  get disposed(): boolean { return this.revision < 0 }
  set disposed(value: boolean) {
    const rev = this.revision
    if (rev < 0 !== value)
      (this.data[Meta.Revision] as ValueSnapshot).content = ~rev
  }
}

// ObjectHandle

export class ObjectHandle {
  private static generator: number = 19

  readonly id: number
  readonly data: any
  readonly proxy: any
  applied: ObjectSnapshot
  editing?: ObjectSnapshot
  editors: number
  hint: string

  constructor(data: any, proxy: any, handler: ProxyHandler<ObjectHandle>, applied: ObjectSnapshot, hint: string) {
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

export type PatchSet = Map<object, Map<MemberName, ValuePatch>>

export type ValuePatch = {
  memberName: MemberName
  patchKind: "update" | "add" | "remove"
  freshValue: any
  formerValue: any
}
