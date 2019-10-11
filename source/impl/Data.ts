// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils } from '../util/Utils'

// Context

export interface Context {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
  readonly applied: boolean
}

// Field

export type FieldKey = PropertyKey

export interface FieldHint {
  readonly times: number
  readonly record: Record
  readonly field: FieldKey
}

export class Observable {
  value: any
  replacement?: Record
  observers?: Set<Observer>
  get copyOnWriteMode(): boolean { return true }
  constructor(value: any) { this.value = value }
}

// Record

export class Record {
  readonly snapshot: Context
  readonly prev: { record: Record }
  readonly data: any
  readonly changes: Set<FieldKey>
  readonly conflicts: Map<FieldKey, Record>

  constructor(creator: Context, prev: Record | undefined, data: object) {
    this.snapshot = creator
    this.prev = { record: prev || this } // loopback if prev is undefined
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
  invalidateDueTo(cause: Observable, hint: FieldHint, since: number, triggers: Observer[]): void
  trig(timestamp: number, now: boolean, nothrow: boolean): void
}
