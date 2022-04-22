// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Log } from '../util/Dbg'
import { Meta } from './Meta'
export { Meta } from './Meta'

// AbstractSnapshot

export interface AbstractSnapshot {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
  readonly sealed: boolean
}

// Subscription & Subscriber

export class Subscription {
  content: any
  subscribers?: Set<Subscriber>
  get isOperation(): boolean { return false }
  get originSnapshotId(): number | undefined { return 0 }
  constructor(content: any) { this.content = content }
}

export type StandaloneMode = boolean | 'isolated' | 'disposal'

export interface Subscriber {
  readonly order: number
  readonly subscriptions: Map<Subscription, SubscriptionInfo> | undefined
  readonly obsoleteSince: number
  hint(nop?: boolean): string
  markObsoleteDueTo(subscription: Subscription, memberName: MemberName, snapshot: AbstractSnapshot, holder: DataHolder, outer: string, since: number, reactions: Array<Subscriber>): void
  runIfNotUpToDate(now: boolean, nothrow: boolean): void
}

export type MemberName = PropertyKey

export interface SubscriptionInfo {
  readonly memberHint: string
  readonly usageCount: number
}

// DataRevision

export class DataRevision {
  readonly snapshot: AbstractSnapshot
  readonly former: { revision: DataRevision }
  readonly data: any
  readonly changes: Set<MemberName>
  readonly conflicts: Map<MemberName, DataRevision>

  constructor(snapshot: AbstractSnapshot, former: DataRevision | undefined, data: object) {
    this.snapshot = snapshot
    this.former = { revision: former || this } // undefined former means initialization of ROOT_REV
    this.data = data
    this.changes = new Set<MemberName>()
    this.conflicts = new Map<MemberName, DataRevision>()
    if (Log.isOn)
      Object.freeze(this)
  }
}

// DataHolder

export class DataHolder {
  private static generator: number = 19

  readonly id: number
  readonly data: any
  readonly proxy: any
  head: DataRevision
  editing?: DataRevision
  editors: number
  hint: string

  constructor(data: any, proxy: any, handler: ProxyHandler<DataHolder>, head: DataRevision, hint: string) {
    this.id = ++DataHolder.generator
    this.data = data
    this.proxy = proxy || new Proxy<DataHolder>(this, handler)
    this.head = head
    this.editing = undefined
    this.editors = 0
    this.hint = hint
  }

  static getHint(obj: object, full: boolean): string | undefined {
    const h = Meta.get<DataHolder | undefined>(obj, Meta.Holder)
    return h !== undefined ? (full ? `${h.hint}#${h.id}` : h.hint) : /* istanbul ignore next */ undefined
  }
}

// PatchSet & DataPatch

export interface PatchSet {
  hint: string
  objects: Map<object, DataPatch>
}

export interface DataPatch {
  data: any
  former: any
}
