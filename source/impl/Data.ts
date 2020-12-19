// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Dbg } from '../util/Dbg'
import { Meta } from './Meta'
export { Meta } from './Meta'

// AbstractSnapshot

export interface AbstractSnapshot {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
  readonly completed: boolean
}

// Observable & Observer

export class Observable {
  value: any
  observers?: Set<Observer>
  next?: ObjectRevision
  get isComputation(): boolean { return false }
  constructor(value: any) { this.value = value }
}

export interface Observer {
  readonly priority: number
  readonly observables: Map<Observable, MemberRef>
  readonly invalidatedSince: number
  hint(notran?: boolean): string
  invalidateDueTo(observable: Observable, cause: MemberRef, since: number, reactions: Observer[]): void
  revalidate(now: boolean, nothrow: boolean): void
}

// ObjectRevision

export type MemberName = PropertyKey

export interface MemberRef {
  readonly revision: ObjectRevision
  readonly member: MemberName
  readonly times: number
}

export class ObjectRevision {
  readonly snapshot: AbstractSnapshot
  readonly prev: { revision: ObjectRevision }
  readonly data: any
  readonly changes: Set<MemberName>
  readonly conflicts: Map<MemberName, ObjectRevision>

  constructor(snapshot: AbstractSnapshot, prev: ObjectRevision | undefined, data: object) {
    this.snapshot = snapshot
    this.prev = { revision: prev || this } // undefined prev means initialization of NIL
    this.data = data
    this.changes = new Set<MemberName>()
    this.conflicts = new Map<MemberName, ObjectRevision>()
    if (Dbg.isOn)
      Object.freeze(this)
  }
}

// ObjectHolder

export class ObjectHolder {
  private static idGen: number = 19

  readonly id: number
  readonly unobservable: any
  readonly proxy: any
  head: ObjectRevision
  changing?: ObjectRevision
  writers: number
  hint: string

  constructor(unobservable: any, proxy: any, handler: ProxyHandler<ObjectHolder>, head: ObjectRevision, hint: string) {
    this.id = ++ObjectHolder.idGen
    this.unobservable = unobservable
    this.proxy = proxy || new Proxy<ObjectHolder>(this, handler)
    this.head = head
    this.changing = undefined
    this.writers = 0
    this.hint = hint
  }

  static getHint(obj: object, full: boolean): string | undefined {
    const h = Meta.get<ObjectHolder>(obj, Meta.Holder)
    return h ? (full ? `${h.hint}#${h.id}` : h.hint) : /* istanbul ignore next */ undefined
  }
}

// Patch

export interface Patch {
  hint: string
  objects: Map<object, ObjectPatch>
}

export interface ObjectPatch {
  changes: any
  old: any
}
