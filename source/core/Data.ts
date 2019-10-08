// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils } from '../util/all'

export const R_HANDLE: unique symbol = Symbol("R:HANDLE")
export const R_CACHE: unique symbol = Symbol("R:CACHE")
export const R_UNMOUNT: unique symbol = Symbol("R:UNMOUNT")

// Context

export interface Context {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
}

// Field

export type FieldKey = PropertyKey

export interface FieldHint {
  readonly times: number
  readonly record: Record
  readonly field: FieldKey
}

export class FieldValue {
  value: any
  replacement?: Record
  observers?: Set<Observer>
  get copyOnWriteMode(): boolean { return true }
  constructor(value: any) { this.value = value }
}

// Record

export class Record {
  static blank: Record // initialized by Transaction._init

  readonly creator: Context
  readonly prev: { record: Record }
  readonly data: any
  readonly changes: Set<FieldKey>
  readonly conflicts: Map<FieldKey, Record>

  constructor(creator: Context, prev: Record, data: object) {
    this.creator = creator
    this.prev = { record: prev }
    this.data = data
    this.changes = new Set<FieldKey>()
    this.conflicts = new Map<FieldKey, Record>()
    Object.freeze(this)
  }

  freeze(): void {
    Object.freeze(this.data)
    Utils.freezeSet(this.changes)
    Utils.freezeMap(this.conflicts)
  }
}

// Handle

export class Handle {
  private static id: number = 20

  readonly id: number
  readonly stateless: any
  readonly proxy: any
  head: Record
  changing?: Record
  writers: number
  hint: string

  constructor(stateless: any, proxy: any, handler: ProxyHandler<Handle>, head: Record, hint: string) {
    this.id = ++Handle.id
    this.stateless = stateless
    this.proxy = proxy || new Proxy<Handle>(this, handler)
    this.head = head
    this.changing = undefined
    this.writers = 0
    this.hint = hint
  }
}

// Observer

export interface Observer {
  hint(notran?: boolean): string
  readonly invalid: { since: number }
  invalidateDueTo(cause: FieldValue, hint: FieldHint, since: number, triggers: Observer[]): void
  trig(timestamp: number, now: boolean, nothrow: boolean): void
}
