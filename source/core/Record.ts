// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef } from './Utils'

export type F<T> = (...args: any[]) => T

// Field

export type FieldKey = PropertyKey

export class FieldValue {
  value: any
  replacedBy?: Record
  observers?: Set<ICacheResult>
  get copyOnWriteMode(): boolean { return true }

  constructor(value: any) {
    this.value = value
  }
}

export type FieldHint = {
  readonly times: number
  readonly record: Record
  readonly field: FieldKey
}

// Record

export class Record {
  readonly prev: { record: Record }
  readonly snapshot: ISnapshot
  readonly data: any
  readonly changes: Set<FieldKey>
  readonly conflicts: Map<FieldKey, Record>

  constructor(prev: Record, snapshot: ISnapshot, data: object) {
    this.prev = { record: prev }
    this.snapshot = snapshot
    this.data = data
    this.changes = new Set<FieldKey>()
    this.conflicts = new Map<FieldKey, Record>()
  }

  static blank: Record

  /* istanbul ignore next */
  static markChanged = function(record: Record, field: FieldKey, changed: boolean, value: any): void {
    return undef() // to be redefined by Cache implementation
  }

  /* istanbul ignore next */
  static markViewed = function(record: Record, field: FieldKey, value: FieldValue, weak: boolean): void {
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

export interface ISnapshot {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
}

export interface ICacheResult {
  hint(notran?: boolean): string
  bind<T>(func: F<T>): F<T>
  readonly invalid: { since: number }
  invalidateDueTo(cause: FieldValue, hint: FieldHint, since: number, triggers: ICacheResult[]): void
  trig(timestamp: number, now: boolean, nothrow: boolean): void
}
