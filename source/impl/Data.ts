// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg } from '../util/Dbg'
import { Meta } from './Meta'
export { Meta } from './Meta'

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
  get isField(): boolean { return true }
  constructor(value: any) { this.value = value }
}

export interface Observer {
  hint(notran?: boolean): string
  priority(): number
  readonly invalidatedSince: number
  invalidateDueTo(value: Observable, cause: MemberHint, since: number, triggers: Observer[]): void
  revalidate(now: boolean, nothrow: boolean): void
}

// Record

export type Member = PropertyKey

export interface MemberHint {
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
    this.prev = { record: prev || this } // undefined prev means initialization of NIL
    this.data = data
    this.changes = new Set<Member>()
    this.conflicts = new Map<Member, Record>()
    if (Dbg.isOn)
      Object.freeze(this)
  }
}

// Handle

export class Handle {
  private static idGen: number = 19

  readonly id: number
  readonly stateless: any
  readonly proxy: any
  head: Record
  changing?: Record
  writers: number
  hint: string

  constructor(stateless: any, proxy: any, handler: ProxyHandler<Handle>, head: Record, hint: string) {
    this.id = ++Handle.idGen
    this.stateless = stateless
    this.proxy = proxy || new Proxy<Handle>(this, handler)
    this.head = head
    this.changing = undefined
    this.writers = 0
    this.hint = hint
  }

  static getHint(obj: object, full: boolean): string | undefined {
    const h = Meta.get<Handle>(obj, Meta.Handle)
    return h ? (full ? `${h.hint}#${h.id}` : h.hint) : /* istanbul ignore next */ undefined
  }
}
