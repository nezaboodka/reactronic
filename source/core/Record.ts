// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef } from './Utils'

export type F<T> = (...args: any[]) => T

// Context

export interface Context {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
}

// Observer

export interface Observer {
  hint(notran?: boolean): string
  bind<T>(func: F<T>): F<T>
  readonly invalid: { since: number }
  invalidateDueTo(cause: FieldValue, hint: FieldHint, since: number, triggers: Observer[]): void
  trig(timestamp: number, now: boolean, nothrow: boolean): void
}

// Field

export type FieldKey = PropertyKey

export class FieldValue {
  value: any
  replacedBy?: Record
  observers?: Set<Observer>
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
  readonly creator: Context
  readonly data: any
  readonly changes: Set<FieldKey>
  readonly conflicts: Map<FieldKey, Record>

  constructor(prev: Record, context: Context, data: object) {
    this.prev = { record: prev }
    this.creator = context
    this.data = data
    this.changes = new Set<FieldKey>()
    this.conflicts = new Map<FieldKey, Record>()
    Object.freeze(this)
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
  }
}
