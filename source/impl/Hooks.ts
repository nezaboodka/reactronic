// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { undef, F } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { CacheOptions, Kind, Reentrance, Sensitivity } from '../Options'
import { TraceOptions, ProfilingOptions } from '../Trace'
import { Controller } from '../Controller'
import { Record, Member, Handle, Observable, Meta } from './Data'
import { Snapshot, Hints, NIL } from './Snapshot'
import { TransactionJournal } from './TransactionJournal'
import { Monitor } from './Monitor'

// ObservableObject

export abstract class ObservableObject {
  constructor() {
    const proto = new.target.prototype
    const blank = Meta.from<any>(proto, Meta.Blank)
    const h = Hooks.createHandle(this, blank, new.target.name)
    if (!Hooks.reactionsAutoStartDisabled) {
      const reactions = Meta.from<any>(proto, Meta.Reactions)
      for (const member in reactions)
        (h.proxy[member][Meta.Method] as Controller<any>).invalidate()
    }
    return h.proxy
  }

  /* istanbul ignore next */
  [Symbol.toStringTag](): string {
    const h = Meta.get<Handle>(this, Meta.Handle)
    return Hints.obj(h)
  }
}

export function decorateMethod(options: Partial<CacheOptions>): F<any> {
  return function(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
    return Hooks.decorateMethod(false, options, proto, prop, pd) /* istanbul ignore next */
  }
}

// Options

const DEFAULT_OPTIONS: CacheOptions = Object.freeze({
  kind: Kind.Data,
  priority: 0,
  noSideEffects: false,
  sensitiveArgs: false,
  throttling: Number.MAX_SAFE_INTEGER, // never revalidate
  reentrance: Reentrance.PreventWithError,
  journal: undefined,
  monitor: null,
  trace: undefined,
})

export class OptionsImpl implements CacheOptions {
  readonly body: Function
  readonly kind: Kind
  readonly priority: number
  readonly noSideEffects: boolean
  readonly sensitiveArgs: boolean
  readonly throttling: number
  readonly reentrance: Reentrance
  readonly journal: TransactionJournal | undefined
  readonly monitor: Monitor | null
  readonly trace?: Partial<TraceOptions>
  static readonly INITIAL = Object.freeze(new OptionsImpl(undef, {body: undef, ...DEFAULT_OPTIONS}, {}, false))

  constructor(body: Function | undefined, existing: OptionsImpl, patch: Partial<OptionsImpl>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body
    this.kind = merge(DEFAULT_OPTIONS.kind, existing.kind, patch.kind, implicit)
    this.priority = merge(DEFAULT_OPTIONS.priority, existing.priority, patch.priority, implicit)
    this.noSideEffects = merge(DEFAULT_OPTIONS.noSideEffects, existing.noSideEffects, patch.noSideEffects, implicit)
    this.sensitiveArgs = merge(DEFAULT_OPTIONS.sensitiveArgs, existing.sensitiveArgs, patch.sensitiveArgs, implicit)
    this.throttling = merge(DEFAULT_OPTIONS.throttling, existing.throttling, patch.throttling, implicit)
    this.reentrance = merge(DEFAULT_OPTIONS.reentrance, existing.reentrance, patch.reentrance, implicit)
    this.journal = merge(DEFAULT_OPTIONS.journal, existing.journal, patch.journal, implicit)
    this.monitor = merge(DEFAULT_OPTIONS.monitor, existing.monitor, patch.monitor, implicit)
    this.trace = merge(DEFAULT_OPTIONS.trace, existing.trace, patch.trace, implicit)
    if (Dbg.isOn)
      Object.freeze(this)
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing
}

// Hooks

export class Hooks implements ProxyHandler<Handle> {
  static reactionsAutoStartDisabled: boolean = false
  static repetitiveReadWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static mainThreadBlockingWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static asyncActionDurationWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static sensitivity: Sensitivity = Sensitivity.ReactOnFinalDifferenceOnly
  static readonly proxy: Hooks = new Hooks()

  getPrototypeOf(h: Handle): object | null {
    return Reflect.getPrototypeOf(h.unobservable)
  }

  get(h: Handle, m: Member, receiver: any): any {
    let result: any
    const r: Record = Snapshot.reader().readable(h, m)
    result = r.data[m]
    if (result instanceof Observable && !result.isMethod) {
      Snapshot.markViewed(r, m, result, Kind.Data, false)
      result = result.value
    }
    else if (m === Meta.Handle) {
      // do nothing, just return instance
    }
    else // result === UNOBSERVABLE
      result = Reflect.get(h.unobservable, m, receiver)
    return result
  }

  set(h: Handle, m: Member, value: any, receiver: any): boolean {
    const r: Record = Snapshot.writer().writable(h, m, value)
    if (r !== NIL) {
      const curr = r.data[m] as Observable
      if (curr !== undefined || (
        r.prev.record.snapshot === NIL.snapshot && m in h.unobservable === false)) {
        const prev = r.prev.record.data[m] as Observable
        let changed = prev === undefined || prev.value !== value ||
          Hooks.sensitivity === Sensitivity.ReactEvenOnSameValueAssignment
        if (changed) {
          if (prev === curr)
            r.data[m] = new Observable(value)
          else
            curr.value = value
        }
        else if (prev !== curr) { // if there was an assignment before
          if (Hooks.sensitivity === Sensitivity.ReactOnFinalDifferenceOnly)
            r.data[m] = prev // restore previous value
          else
            changed = true // Sensitivity.ReactOnFinalAndIntermediateDifference
        }
        Snapshot.markChanged(r, m, value, changed)
      }
      else
        Reflect.set(h.unobservable, m, value, receiver)
    }
    else
      h.unobservable[m] = value
    return true
  }

  has(h: Handle, m: Member): boolean {
    const r: Record = Snapshot.reader().readable(h, m)
    return m in r.data || m in h.unobservable
  }

  getOwnPropertyDescriptor(h: Handle, m: Member): PropertyDescriptor | undefined {
    const r: Record = Snapshot.reader().readable(h, m)
    const pd = Reflect.getOwnPropertyDescriptor(r.data, m)
    if (pd)
      pd.configurable = pd.writable = true
    return pd
  }

  ownKeys(h: Handle): Member[] {
    // TODO: Better implementation to avoid filtering
    const r: Record = Snapshot.reader().readable(h, Meta.Handle)
    const result = []
    for (const m of Object.getOwnPropertyNames(r.data)) {
      const value = r.data[m]
      if (!(value instanceof Observable) || !value.isMethod)
        result.push(m)
    }
    return result
  }

  static decorateField(observable: boolean, proto: any, m: Member): any {
    if (observable) {
      const get = function(this: any): any {
        const h = Hooks.acquireHandle(this)
        return Hooks.proxy.get(h, m, this)
      }
      const set = function(this: any, value: any): boolean {
        const h = Hooks.acquireHandle(this)
        return Hooks.proxy.set(h, m, value, this)
      }
      const enumerable = true
      const configurable = false
      return Object.defineProperty(proto, m, { get, set, enumerable, configurable })
    }
    else
      Meta.acquire(proto, Meta.Blank)[m] = Meta.Unobservable
  }

  static decorateMethod(implicit: boolean, options: Partial<CacheOptions>, proto: any, method: Member, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true
    const configurable: boolean = true
    // Setup method trap
    const opts = Hooks.applyMethodOptions(proto, method, pd.value, true, configurable, options, implicit)
    const trap = function(this: any): any {
      const h = Hooks.acquireHandle(this)
      const value = Hooks.createMethodTrap(h, method, opts)
      Object.defineProperty(h.unobservable, method, { value, enumerable, configurable })
      return value
    }
    return Object.defineProperty(proto, method, { get: trap, enumerable, configurable })
  }

  static acquireHandle(obj: any): Handle {
    let h = obj[Meta.Handle]
    if (!h) {
      if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
        throw misuse('only objects can be reactive')
      const blank = Meta.from<any>(Object.getPrototypeOf(obj), Meta.Blank)
      const initial = new Record(NIL.snapshot, NIL, {...blank})
      Meta.set(initial.data, Meta.Handle, h)
      if (Dbg.isOn)
        Snapshot.freezeRecord(initial)
      h = new Handle(obj, obj, Hooks.proxy, initial, obj.constructor.name)
      Meta.set(obj, Meta.Handle, h)
    }
    return h
  }

  static createHandle(unobservable: any, blank: any, hint: string): Handle {
    const ctx = Snapshot.writer()
    const h = new Handle(unobservable, undefined, Hooks.proxy, NIL, hint)
    ctx.writable(h, Meta.Handle, blank)
    return h
  }

  static setProfilingMode(enabled: boolean, options?: Partial<ProfilingOptions>): void {
    if (enabled) {
      Hooks.repetitiveReadWarningThreshold = options && options.repetitiveReadWarningThreshold !== undefined ? options.repetitiveReadWarningThreshold : 10
      Hooks.mainThreadBlockingWarningThreshold = options && options.mainThreadBlockingWarningThreshold !== undefined ? options.mainThreadBlockingWarningThreshold : 16.6
      Hooks.asyncActionDurationWarningThreshold = options && options.asyncActionDurationWarningThreshold !== undefined ? options.asyncActionDurationWarningThreshold : 150
      Snapshot.garbageCollectionSummaryInterval = options && options.garbageCollectionSummaryInterval !== undefined ? options.garbageCollectionSummaryInterval : 100
    }
    else {
      Hooks.repetitiveReadWarningThreshold = Number.MAX_SAFE_INTEGER
      Hooks.mainThreadBlockingWarningThreshold = Number.MAX_SAFE_INTEGER
      Hooks.asyncActionDurationWarningThreshold = Number.MAX_SAFE_INTEGER
      Snapshot.garbageCollectionSummaryInterval = Number.MAX_SAFE_INTEGER
    }
  }

  static sensitive<T>(sensitivity: Sensitivity, func: F<T>, ...args: any[]): T {
    const restore = Hooks.sensitivity
    Hooks.sensitivity = sensitivity
    try {
      return func(...args)
    }
    finally {
      Hooks.sensitivity = restore
    }
  }

  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const h = Hooks.acquireHandle(obj)
      h.hint = hint
    }
    return obj
  }

  /* istanbul ignore next */
  static createMethodTrap = function(h: Handle, m: Member, options: OptionsImpl): F<any> {
    throw misuse('createMethodTrap should never be called')
  }

  /* istanbul ignore next */
  static applyMethodOptions = function(proto: any, m: Member, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<CacheOptions>, implicit: boolean): OptionsImpl {
    throw misuse('alterBlank should never be called')
  }
}
