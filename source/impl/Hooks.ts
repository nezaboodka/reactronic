// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef, F } from '../util/Utils'
import { misuse } from '../util/Dbg'
import { CopyOnWriteArray, CopyOnWrite } from '../util/CopyOnWriteArray'
import { CopyOnWriteSet } from '../util/CopyOnWriteSet'
import { CopyOnWriteMap } from '../util/CopyOnWriteMap'
import { Record, FieldKey, Observable, Instance } from './Data'
import { Snapshot, Hints, NIL, SYM_INSTANCE, SYM_METHOD, SYM_STATELESS, SYM_BLANK, SYM_TRIGGERS } from './Snapshot'
import { Options, Kind, Reentrance } from '../Options'
import { Monitor } from '../Monitor'
import { Cache } from '../Cache'
import { Trace } from '../Trace'

// State

const EMPTY_META = Object.freeze({})

export abstract class State {
  constructor() {
    const proto = new.target.prototype
    const blank = Hooks.getMeta<any>(proto, SYM_BLANK)
    const o = Hooks.createInstance(this, blank, new.target.name)
    if (!Hooks.triggersAutoStartDisabled) {
      const triggers = Hooks.getMeta<any>(proto, SYM_TRIGGERS)
      for (const field in triggers)
        (o.proxy[field][SYM_METHOD] as Cache<any>).invalidate()
    }
    return o.proxy
  }

  /* istanbul ignore next */
  [Symbol.toStringTag](): string {
    const o = Utils.get<Instance>(this, SYM_INSTANCE)
    return Hints.instance(o)
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
  delay: -2, // never
  reentrance: Reentrance.PreventWithError,
  cachedArgs: false,
  monitor: null,
  trace: undefined,
})

export class OptionsImpl implements Options {
  readonly body: Function
  readonly kind: Kind
  readonly cachedArgs: boolean
  readonly delay: number
  readonly reentrance: Reentrance
  readonly monitor: Monitor | null
  readonly trace?: Partial<Trace>
  static readonly INITIAL = Object.freeze(new OptionsImpl(undef, {body: undef, ...DEFAULT_STATELESS_OPTIONS}, {}, false))

  constructor(body: Function | undefined, existing: OptionsImpl, patch: Partial<OptionsImpl>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body
    this.kind = merge(DEFAULT_STATELESS_OPTIONS.kind, existing.kind, patch.kind, implicit)
    this.cachedArgs = merge(DEFAULT_STATELESS_OPTIONS.cachedArgs, existing.cachedArgs, patch.cachedArgs, implicit)
    this.delay = merge(DEFAULT_STATELESS_OPTIONS.delay, existing.delay, patch.delay, implicit)
    this.reentrance = merge(DEFAULT_STATELESS_OPTIONS.reentrance, existing.reentrance, patch.reentrance, implicit)
    this.monitor = merge(DEFAULT_STATELESS_OPTIONS.monitor, existing.monitor, patch.monitor, implicit)
    this.trace = merge(DEFAULT_STATELESS_OPTIONS.trace, existing.trace, patch.trace, implicit)
    Object.freeze(this)
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing
}

// Hooks

export class Hooks implements ProxyHandler<Instance> {
  static triggersAutoStartDisabled: boolean = false
  static performanceWarningThreshold: number = 10
  static readonly proxy: Hooks = new Hooks()

  getPrototypeOf(o: Instance): object | null {
    return Reflect.getPrototypeOf(o.stateless)
  }

  get(o: Instance, f: FieldKey, receiver: any): any {
    let result: any
    const ctx = Snapshot.readable()
    const r: Record = ctx.read(o)
    result = r.data[f]
    if (result instanceof Observable && !result.isComputed) {
      Snapshot.markViewed(r, f, result, Kind.Field, false)
      result = result.value
    }
    else if (f === SYM_INSTANCE) {
      // do nothing, just return instance
    }
    else { // value === STATELESS
      result = Reflect.get(o.stateless, f, receiver)
      if (result === undefined && f !== Symbol.toPrimitive)
        // Record.markViewed(r, field, false); // treat undefined fields as stateful
        throw misuse(`unassigned properties are not supported: ${Hints.record(r, f)} is used by T${ctx.id} (${ctx.hint})`)
    }
    return result
  }

  set(o: Instance, f: FieldKey, value: any, receiver: any): boolean {
    const r: Record = Snapshot.writable().write(o, f, value)
    if (r !== NIL) {
      const curr = r.data[f] as Observable
      const prev = r.prev.record.data[f] as Observable
      const changed = prev === undefined || prev.value !== value
      if (changed) {
        if (prev === curr)
          r.data[f] = new Observable(value)
        else
          curr.value = value
      }
      else if (prev !== curr)
        r.data[f] = prev // restore previous value
      Snapshot.markChanged(r, f, value, changed)
    }
    else
      o.stateless[f] = value
    return true
  }

  getOwnPropertyDescriptor(o: Instance, f: FieldKey): PropertyDescriptor | undefined {
    const r: Record = Snapshot.readable().read(o)
    const pd = Reflect.getOwnPropertyDescriptor(r.data, f)
    if (pd)
      pd.configurable = pd.writable = true
    return pd
  }

  ownKeys(o: Instance): FieldKey[] {
    // TODO: Better implementation to avoid filtering
    const r: Record = Snapshot.readable().read(o)
    const result = []
    for (const field of Object.getOwnPropertyNames(r.data)) {
      const value = r.data[field]
      if (typeof(value) !== 'object' || value.constructor.name !== 'CacheResult')
        result.push(field)
    }
    return result
  }

  static decorateField(stateful: boolean, proto: any, f: FieldKey): any {
    if (stateful) {
      const get = function(this: any): any {
        const o = Hooks.acquireInstance(this)
        return Hooks.proxy.get(o, f, this)
      }
      const set = function(this: any, value: any): boolean {
        const o = Hooks.acquireInstance(this)
        return Hooks.proxy.set(o, f, value, this)
      }
      const enumerable = true
      const configurable = false
      return Object.defineProperty(proto, f, { get, set, enumerable, configurable })
    }
    else
      Hooks.acquireMeta(proto, SYM_BLANK)[f] = SYM_STATELESS
  }

  static decorateMethod(implicit: boolean, options: Partial<Options>, proto: any, method: FieldKey, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true
    const configurable: boolean = true
    // Setup method trap
    const opts = Hooks.applyOptions(proto, method, pd.value, true, configurable, options, implicit)
    const trap = function(this: any): any {
      const stateful = this instanceof State
      const o = stateful ? Utils.get<Instance>(this, SYM_INSTANCE) : Hooks.acquireInstance(this)
      const value = Hooks.createMethodTrap(o, method, opts)
      Object.defineProperty(o.stateless, method, { value, enumerable, configurable })
      return value
    }
    return Object.defineProperty(proto, method, { get: trap, enumerable, configurable })
  }

  static acquireMeta(proto: any, sym: symbol): any {
    let meta: any = proto[sym]
    if (!proto.hasOwnProperty(sym)) {
      meta = Object.setPrototypeOf({}, meta || {})
      Utils.set(proto, sym, meta)
    }
    return meta
  }

  static getMeta<T>(proto: any, sym: symbol): T {
    return proto[sym] || /* istanbul ignore next */ EMPTY_META
  }

  static acquireInstance(obj: any): Instance {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw misuse('only objects can be reactive')
    let o = Utils.get<Instance>(obj, SYM_INSTANCE)
    if (!o) {
      const blank = Hooks.getMeta<any>(Object.getPrototypeOf(obj), SYM_BLANK)
      const initial = new Record(NIL.snapshot, NIL, {...blank})
      Utils.set(initial.data, SYM_INSTANCE, o)
      Snapshot.freezeRecord(initial)
      o = new Instance(obj, obj, Hooks.proxy, initial, obj.constructor.name)
      Utils.set(obj, SYM_INSTANCE, o)
      // Hooks.decorateField(false, {kind: Kind.Stateful}, obj, UNMOUNT)
    }
    return o
  }

  static createInstance(stateless: any, blank: any, hint: string): Instance {
    const ctx = Snapshot.writable()
    const o = new Instance(stateless, undefined, Hooks.proxy, NIL, hint)
    ctx.write(o, SYM_INSTANCE, blank)
    return o
  }

  /* istanbul ignore next */
  static createMethodTrap = function(o: Instance, f: FieldKey, options: OptionsImpl): F<any> {
    throw misuse('createMethodTrap should never be called')
  }

  /* istanbul ignore next */
  static applyOptions = function(proto: any, f: FieldKey, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<Options>, implicit: boolean): OptionsImpl {
    throw misuse('alterBlank should never be called')
  }
}

export class CopyOnWriteProxy implements ProxyHandler<CopyOnWrite<any>> {
  static readonly global: CopyOnWriteProxy = new CopyOnWriteProxy()

  get(binding: CopyOnWrite<any>, field: FieldKey, receiver: any): any {
    const a: any = binding.readable(receiver)
    return a[field]
  }

  set(binding: CopyOnWrite<any>, field: FieldKey, value: any, receiver: any): boolean {
    const a: any = binding.writable(receiver)
    return a[field] = value
  }

  static seal(observable: Observable | symbol, proxy: any, field: FieldKey): void {
    if (observable instanceof Observable) {
      const v = observable.value
      if (Array.isArray(v)) {
        if (!Object.isFrozen(v)) {
          if (!observable.isComputed)
            observable.value = new Proxy(CopyOnWriteArray.seal(proxy, field, v), CopyOnWriteProxy.global)
          else
            Object.freeze(v) // just freeze without copy-on-write hooks
        }
      }
      else if (v instanceof Set) {
        if (!Object.isFrozen(v)) {
          if (!observable.isComputed)
            observable.value = new Proxy(CopyOnWriteSet.seal(proxy, field, v), CopyOnWriteProxy.global)
          else
            Utils.freezeSet(v) // just freeze without copy-on-write hooks
        }
      }
      else if (v instanceof Map) {
        if (!Object.isFrozen(v)) {
          if (!observable.isComputed)
            observable.value = new Proxy(CopyOnWriteMap.seal(proxy, field, v), CopyOnWriteProxy.global)
          else
            Utils.freezeMap(v) // just freeze without copy-on-write hooks
        }
      }
    }
  }
}
