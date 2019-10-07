// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef } from './Utils'

export const R_UNMOUNT: unique symbol = Symbol("R:UNMOUNT")

// Property

export type PropKey = PropertyKey

export class PropValue {
  value: any
  replacedBy?: Record
  observers?: Set<ICacheResult>
  get copyOnWriteMode(): boolean { return true }

  constructor(value: any) {
    this.value = value
  }
}

export type PropHint = {
  readonly times: number,
  readonly record: Record,
  readonly prop: PropKey,
}

// Record

export class Record {
  readonly prev: { record: Record }
  readonly snapshot: ISnapshot
  readonly data: any
  readonly changes: Set<PropKey>
  readonly conflicts: Map<PropKey, Record>

  constructor(prev: Record, snapshot: ISnapshot, data: object) {
    this.prev = { record: prev }
    this.snapshot = snapshot
    this.data = data
    this.changes = new Set<PropKey>()
    this.conflicts = new Map<PropKey, Record>()
  }

  static blank: Record

  /* istanbul ignore next */
  static markChanged = function(r: Record, prop: PropKey, changed: boolean, value: any): void {
    return undef() // to be redefined by Cache implementation
  }

  /* istanbul ignore next */
  static markViewed = function(r: Record, prop: PropKey, value: PropValue, weak: boolean): void {
    return undef() // to be redefined by Cache implementation
  }

  freeze<T, C>(): void {
    Object.freeze(this.data)
    Utils.freezeSet(this.changes)
    Utils.freezeMap(this.conflicts)
    Object.freeze(this)
  }
}

// Dependencies (abstract)

export type F<T> = (...args: any[]) => T

export interface ISnapshot {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
}

export interface ICacheResult {
  hint(notran?: boolean): string
  bind<T>(func: F<T>): F<T>
  readonly invalid: { since: number }
  invalidateDueTo(cause: PropValue, hint: PropHint, since: number, triggers: ICacheResult[]): void
  trig(timestamp: number, now: boolean, nothrow: boolean): void
}
