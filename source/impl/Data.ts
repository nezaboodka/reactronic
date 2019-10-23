// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

// Context

export interface Context {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
  readonly completed: boolean
}

// Observables & Observer

export class Observable {
  value: any
  replacement?: Record
  observers?: Set<Observer>
  get isComputed(): boolean { return false }
  constructor(value: any) { this.value = value }
}

export interface Observer {
  hint(notran?: boolean): string
  readonly invalid: { since: number }
  invalidateDueTo(value: Observable, cause: FieldHint, since: number, triggers: Observer[]): void
  recompute(now: boolean, nothrow: boolean): void
}

// Record

export type Member = PropertyKey

export interface FieldHint {
  readonly record: Record
  readonly member: Member
  readonly times: number
}

export class Record {
  readonly snapshot: Context
  readonly prev: { record: Record }
  readonly data: any
  readonly changes: Set<Member>
  readonly conflicts: Map<Member, Record>

  constructor(snapshot: Context, prev: Record | undefined, data: object) {
    this.snapshot = snapshot
    this.prev = { record: prev || this } // loopback if prev is undefined
    this.data = data
    this.changes = new Set<Member>()
    this.conflicts = new Map<Member, Record>()
    Object.freeze(this)
  }
}

// Instance

export class Instance {
  private static id: number = 19

  readonly id: number
  readonly stateless: any
  readonly proxy: any
  head: Record
  changing?: Record
  writers: number
  hint: string

  constructor(stateless: any, proxy: any, handler: ProxyHandler<Instance>, head: Record, hint: string) {
    this.id = ++Instance.id
    this.stateless = stateless
    this.proxy = proxy || new Proxy<Instance>(this, handler)
    this.head = head
    this.changing = undefined
    this.writers = 0
    this.hint = hint
  }
}
