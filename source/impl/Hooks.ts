// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef, F } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { CopyOnWriteArray, CopyOnWrite } from '../util/CopyOnWriteArray'
import { CopyOnWriteSet } from '../util/CopyOnWriteSet'
import { CopyOnWriteMap } from '../util/CopyOnWriteMap'
import { Record, Member, Observable } from './Data'
import { Snapshot, RObject, Hints, NIL, SYM_OBJECT, SYM_METHOD, SYM_BLANK, SYM_TRIGGERS, STATELESS } from './Snapshot'
import { Options, Kind, Reentrance } from '../Options'
import { Monitor } from '../Monitor'
import { Cache } from '../Cache'
import { LoggingOptions, ProfilingOptions } from '../Logging'

// State

const EMPTY_META = Object.freeze({})

export abstract class Stateful {
  constructor() {
    const proto = new.target.prototype
    const blank = Hooks.getMeta<any>(proto, SYM_BLANK)
    const o = Hooks.createInstance(this, blank, new.target.name)
    if (!Hooks.triggersAutoStartDisabled) {
      const triggers = Hooks.getMeta<any>(proto, SYM_TRIGGERS)
      for (const member in triggers)
        (o.proxy[member][SYM_METHOD] as Cache<any>).invalidate()
    }
    return o.proxy
  }

  /* istanbul ignore next */
  [Symbol.toStringTag](): string {
    const o = Utils.get<RObject>(this, SYM_OBJECT)
    return Hints.obj(o)
  }
}

export function options(options: Partial<Options>): F<any> {
  return function(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
    return Hooks.decorateMethod(false, options, proto, prop, pd) /* istanbul ignore next */
  }
}

// Options

const DEFAULT_STATELESS_OPTIONS: Options = Object.freeze({
  kind: Kind.Field,
  priority: 0,
  throttling: Number.MAX_SAFE_INTEGER, // never revalidate
  reentrance: Reentrance.PreventWithError,
  incentiveArgs: false,
  monitor: null,
  logging: undefined,
})

export class OptionsImpl implements Options {
  readonly body: Function
  readonly kind: Kind
  readonly priority: number
  readonly incentiveArgs: boolean
  readonly throttling: number
  readonly reentrance: Reentrance
  readonly monitor: Monitor | null
  readonly logging?: Partial<LoggingOptions>
  static readonly INITIAL = Object.freeze(new OptionsImpl(undef, {body: undef, ...DEFAULT_STATELESS_OPTIONS}, {}, false))

  constructor(body: Function | undefined, existing: OptionsImpl, patch: Partial<OptionsImpl>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body
    this.kind = merge(DEFAULT_STATELESS_OPTIONS.kind, existing.kind, patch.kind, implicit)
    this.priority = merge(DEFAULT_STATELESS_OPTIONS.priority, existing.priority, patch.priority, implicit)
    this.incentiveArgs = merge(DEFAULT_STATELESS_OPTIONS.incentiveArgs, existing.incentiveArgs, patch.incentiveArgs, implicit)
    this.throttling = merge(DEFAULT_STATELESS_OPTIONS.throttling, existing.throttling, patch.throttling, implicit)
    this.reentrance = merge(DEFAULT_STATELESS_OPTIONS.reentrance, existing.reentrance, patch.reentrance, implicit)
    this.monitor = merge(DEFAULT_STATELESS_OPTIONS.monitor, existing.monitor, patch.monitor, implicit)
    this.logging = merge(DEFAULT_STATELESS_OPTIONS.logging, existing.logging, patch.logging, implicit)
    if (Dbg.isOn) Object.freeze(this)
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing
}

// Hooks

export class Hooks implements ProxyHandler<RObject> {
  static triggersAutoStartDisabled: boolean = false
  static repetitiveReadWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static mainThreadBlockingWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static asyncActionDurationWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static readonly proxy: Hooks = new Hooks()

  getPrototypeOf(o: RObject): object | null {
    return Reflect.getPrototypeOf(o.stateless)
  }

  has(o: RObject, m: Member): boolean {
    const r: Record = Snapshot.readable().read(o)
    return m in r.data || m in o.stateless
  }

  get(o: RObject, m: Member, receiver: any): any {
    let result: any
    const ctx = Snapshot.readable()
    const r: Record = ctx.read(o)
    result = r.data[m]
    if (result instanceof Observable && result.isField) {
      Snapshot.markViewed(r, m, result, Kind.Field, false)
      result = result.value
    }
    else if (m === SYM_OBJECT) {
      // do nothing, just return instance
    }
    else // result === STATELESS
      result = Reflect.get(o.stateless, m, receiver)
    return result
  }

  set(o: RObject, m: Member, value: any, receiver: any): boolean {
    const r: Record = Snapshot.writable().write(o, m, value)
    if (r !== NIL) {
      const curr = r.data[m] as Observable
      if (curr !== undefined || r.prev.record.snapshot === NIL.snapshot) {
        const prev = r.prev.record.data[m] as Observable
        const changed = prev === undefined || prev.value !== value
        if (changed) {
          if (prev === curr)
            r.data[m] = new Observable(value)
          else
            curr.value = value
        }
        else if (prev !== curr)
          r.data[m] = prev // restore previous value
        Snapshot.markChanged(r, m, value, changed)
      }
      else
        Reflect.set(Object.getPrototypeOf(o.stateless), m, value, receiver)
    }
    else
      o.stateless[m] = value
    return true
  }

  getOwnPropertyDescriptor(o: RObject, m: Member): PropertyDescriptor | undefined {
    const r: Record = Snapshot.readable().read(o)
    const pd = Reflect.getOwnPropertyDescriptor(r.data, m)
    if (pd)
      pd.configurable = pd.writable = true
    return pd
  }

  ownKeys(o: RObject): Member[] {
    // TODO: Better implementation to avoid filtering
    const r: Record = Snapshot.readable().read(o)
    const result = []
    for (const m of Object.getOwnPropertyNames(r.data)) {
      const value = r.data[m]
      if (typeof(value) !== 'object' || value.constructor.name !== 'CacheResult')
        result.push(m)
    }
    return result
  }

  static decorateField(stateful: boolean, proto: any, m: Member): any {
    if (stateful) {
      const get = function(this: any): any {
        const o = Hooks.acquireInstance(this)
        return Hooks.proxy.get(o, m, this)
      }
      const set = function(this: any, value: any): boolean {
        const o = Hooks.acquireInstance(this)
        return Hooks.proxy.set(o, m, value, this)
      }
      const enumerable = true
      const configurable = false
      return Object.defineProperty(proto, m, { get, set, enumerable, configurable })
    }
    else
      Hooks.acquireMeta(proto, SYM_BLANK)[m] = STATELESS
  }

  static decorateMethod(implicit: boolean, options: Partial<Options>, proto: any, method: Member, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true
    const configurable: boolean = true
    // Setup method trap
    const opts = Hooks.applyOptions(proto, method, pd.value, true, configurable, options, implicit)
    const trap = function(this: any): any {
      const o = this instanceof Stateful ? Utils.get<RObject>(this, SYM_OBJECT) : Hooks.acquireInstance(this)
      const value = Hooks.createMethodTrap(o, method, opts)
      Object.defineProperty(o.stateless, method, { value, enumerable, configurable })
      return value
    }
    return Object.defineProperty(proto, method, { get: trap, enumerable, configurable })
  }

  static acquireMeta(proto: any, sym: symbol): any {
    let meta: any = proto[sym]
    if (!proto.hasOwnProperty(sym)) {
      meta = {...meta} // clone meta from parent class
      Utils.set(proto, sym, meta)
    }
    return meta
  }

  static getMeta<T>(proto: any, sym: symbol): T {
    return proto[sym] || /* istanbul ignore next */ EMPTY_META
  }

  static acquireInstance(obj: any): RObject {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw misuse('only objects can be reactive')
    let o = Utils.get<RObject>(obj, SYM_OBJECT)
    if (!o) {
      const blank = Hooks.getMeta<any>(Object.getPrototypeOf(obj), SYM_BLANK)
      const initial = new Record(NIL.snapshot, NIL, {...blank})
      Utils.set(initial.data, SYM_OBJECT, o)
      if (Dbg.isOn) Snapshot.freezeRecord(initial)
      o = new RObject(obj, obj, Hooks.proxy, initial, obj.constructor.name)
      Utils.set(obj, SYM_OBJECT, o)
    }
    return o
  }

  static createInstance(stateless: any, blank: any, hint: string): RObject {
    const ctx = Snapshot.writable()
    const o = new RObject(stateless, undefined, Hooks.proxy, NIL, hint)
    ctx.write(o, SYM_OBJECT, blank)
    return o
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

  /* istanbul ignore next */
  static createMethodTrap = function(o: RObject, m: Member, options: OptionsImpl): F<any> {
    throw misuse('createMethodTrap should never be called')
  }

  /* istanbul ignore next */
  static applyOptions = function(proto: any, m: Member, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<Options>, implicit: boolean): OptionsImpl {
    throw misuse('alterBlank should never be called')
  }
}

export class CopyOnWriteProxy implements ProxyHandler<CopyOnWrite<any>> {
  static readonly global: CopyOnWriteProxy = new CopyOnWriteProxy()

  getPrototypeOf(binding: CopyOnWrite<any>): object | null {
    return Object.getPrototypeOf(binding.value)
  }

  get(binding: CopyOnWrite<any>, m: Member, receiver: any): any {
    const a: any = binding.readable(receiver)
    return a[m]
  }

  set(binding: CopyOnWrite<any>, m: Member, value: any, receiver: any): boolean {
    const a: any = binding.writable(receiver)
    return a[m] = value
  }

  static seal(observable: Observable | symbol, proxy: any, m: Member): void {
    if (observable instanceof Observable) {
      const v = observable.value
      if (Array.isArray(v) || v instanceof Array) {
        if (v instanceof CopyOnWriteArray && !Array.isArray(v)) {
          throw misuse(`${Hints.getHint(proxy)}.${m.toString()} collection cannot be reused from another property without cloning`)
        }
        else if (!Object.isFrozen(v)) {
          if (observable.isField)
            observable.value = new Proxy(CopyOnWriteArray.seal(proxy, m, v), CopyOnWriteProxy.global)
          else
            Object.freeze(v) // just freeze without copy-on-write hooks
        }
      }
      else if (v instanceof Set) {
        /*if (v instanceof CopyOnWriteSet) {
          throw misuse(`${Hints.getHint(proxy)}.${m.toString()} collection cannot be reused from another property without cloning`)
        }
        else*/ if (!Object.isFrozen(v)) {
          if (observable.isField)
            observable.value = new Proxy(CopyOnWriteSet.seal(proxy, m, v), CopyOnWriteProxy.global)
          else
            Utils.freezeSet(v) // just freeze without copy-on-write hooks
        }
      }
      else if (v instanceof Map) {
        /*if (v instanceof CopyOnWriteMap) {
          throw misuse(`${Hints.getHint(proxy)}.${m.toString()} collection cannot be reused from another property without cloning`)
        }
        else*/ if (!Object.isFrozen(v)) {
          if (observable.isField)
            observable.value = new Proxy(CopyOnWriteMap.seal(proxy, m, v), CopyOnWriteProxy.global)
          else
            Utils.freezeMap(v) // just freeze without copy-on-write hooks
        }
      }
    }
  }
}
