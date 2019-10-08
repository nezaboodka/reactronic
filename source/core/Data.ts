// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef } from '../util/all'

export const R_HANDLE: unique symbol = Symbol("R:HANDLE")
export const R_CACHE: unique symbol = Symbol("R:CACHE")
export const R_UNMOUNT: unique symbol = Symbol("R:UNMOUNT")
export type F<T> = (...args: any[]) => T

// Context

export interface Context {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
}

// Field

export type FieldKey = PropertyKey

export type FieldHint = {
  readonly times: number
  readonly record: Record
  readonly field: FieldKey
}

export class FieldValue {
  value: any
  replacer?: Record
  observers?: Set<Observer>
  get copyOnWriteMode(): boolean { return true }
  constructor(value: any) { this.value = value }
}

// Record

export class Record {
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

  static blank: Record

  /* istanbul ignore next */
  static markChanged = function(record: Record, field: FieldKey, value: any, changed: boolean): void {
    return undef() // to be redefined by Cache implementation
  }

  /* istanbul ignore next */
  static markViewed = function(record: Record, field: FieldKey, value: FieldValue, weak: boolean): void {
    return undef() // to be redefined by Cache implementation
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

  readonly stateless: any
  readonly id: number
  readonly proxy: any
  hint: string
  head: Record
  changing?: Record
  writers: number

  constructor(stateless: any, proxy: any, hint: string, handler: ProxyHandler<Handle>) {
    this.stateless = stateless
    this.id = ++Handle.id
    this.proxy = proxy || new Proxy<Handle>(this, handler)
    this.hint = hint
    this.head = Record.blank
    this.changing = undefined
    this.writers = 0
  }

  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const h = Utils.get<Handle>(obj, R_HANDLE)
      if (h)
        h.hint = hint
    }
    return obj
  }

  static getHint(obj: object): string | undefined {
    const h = Utils.get<Handle>(obj, R_HANDLE)
    return h ? h.hint : undefined
  }
}

// Observer

export interface Observer {
  hint(notran?: boolean): string
  bind<T>(func: F<T>): F<T>
  readonly invalid: { since: number }
  invalidateDueTo(cause: FieldValue, hint: FieldHint, since: number, triggers: Observer[]): void
  trig(timestamp: number, now: boolean, nothrow: boolean): void
}

// Hint

export class Hint {
  static handle(h: Handle | undefined, field?: FieldKey | undefined, stamp?: number, tran?: number, typeless?: boolean): string {
    const obj = h === undefined
      ? "blank"
      : (typeless
        ? (stamp === undefined ? `#${h.id}` : `v${stamp}t${tran}#${h.id}`)
        : (stamp === undefined ? `#${h.id} ${h.hint}` : `v${stamp}t${tran}#${h.id} ${h.hint}`))
    return field !== undefined ? `${obj}.${field.toString()}` : obj
  }

  static record(r: Record, field?: FieldKey, typeless?: boolean): string {
    const h = Utils.get<Handle | undefined>(r.data, R_HANDLE)
    return Hint.handle(h, field, r.creator.timestamp, r.creator.id, typeless)
  }

  static conflicts(conflicts: Record[]): string {
    return conflicts.map(ours => {
      const items: string[] = []
      ours.conflicts.forEach((theirs: Record, field: FieldKey) => {
        items.push(Hint.conflictingFieldHint(field, ours, theirs))
      })
      return items.join(", ")
    }).join(", ")
  }

  static conflictingFieldHint(field: FieldKey, ours: Record, theirs: Record): string {
    return Hint.record(theirs, field)
  }
}
