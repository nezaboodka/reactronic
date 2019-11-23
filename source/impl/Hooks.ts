// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef, F } from '../util/Utils'
import { misuse } from '../util/Dbg'
import { CopyOnWriteArray, CopyOnWrite } from '../util/CopyOnWriteArray'
import { CopyOnWriteSet } from '../util/CopyOnWriteSet'
import { CopyOnWriteMap } from '../util/CopyOnWriteMap'
import { Record, Member, Observable } from './Data'
import { Snapshot, RObject, Hints, NIL, SYM_OBJECT, SYM_METHOD, SYM_BLANK, SYM_TRIGGERS, STATELESS } from './Snapshot'
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
  delay: -2, // never
  reentrance: Reentrance.PreventWithError,
  urgingArgs: false,
  monitor: null,
  trace: undefined,
})

export class OptionsImpl implements Options {
  readonly body: Function
  readonly kind: Kind
  readonly urgingArgs: boolean
  readonly delay: number
  readonly reentrance: Reentrance
  readonly monitor: Monitor | null
  readonly trace?: Partial<Trace>
  static readonly INITIAL = Object.freeze(new OptionsImpl(undef, {body: undef, ...DEFAULT_STATELESS_OPTIONS}, {}, false))

  constructor(body: Function | undefined, existing: OptionsImpl, patch: Partial<OptionsImpl>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body
    this.kind = merge(DEFAULT_STATELESS_OPTIONS.kind, existing.kind, patch.kind, implicit)
    this.urgingArgs = merge(DEFAULT_STATELESS_OPTIONS.urgingArgs, existing.urgingArgs, patch.urgingArgs, implicit)
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

export class Hooks implements ProxyHandler<RObject> {
  static triggersAutoStartDisabled: boolean = false
  static repetitiveReadWarningThreshold: number = 10
  static readonly proxy: Hooks = new Hooks()

  getPrototypeOf(o: RObject): object | null {
    return Reflect.getPrototypeOf(o.stateless)
  }

  get(o: RObject, m: Member, receiver: any): any {
    let result: any
    const ctx = Snapshot.readable()
    const r: Record = ctx.read(o)
    result = r.data[m]
    if (result instanceof Observable && !result.isComputed) {
      Snapshot.markViewed(r, m, result, Kind.Field, false)
      result = result.value
    }
    else if (m === SYM_OBJECT) {
      // do nothing, just return instance
    }
    else { // value === STATELESS
      result = Reflect.get(o.stateless, m, receiver)
      if (result === undefined && m !== Symbol.toPrimitive && m !== '$$typeof')
        // Record.markViewed(r, m, false); // treat undefined fields as stateful
        // Dbg.log('', '', `unassigned property is used: ${Hints.record(r, m)} is used by T${ctx.id} (${ctx.hint})`, undefined, ' make sure it is not stateful property')
        throw misuse(`unassigned properties are not supported: ${Hints.record(r, m)} is used by T${ctx.id} (${ctx.hint})`)
    }
    return result
  }

  set(o: RObject, m: Member, value: any, receiver: any): boolean {
    const r: Record = Snapshot.writable().write(o, m, value)
    if (r !== NIL) {
      const curr = r.data[m] as Observable
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
      const o = this instanceof State ? Utils.get<RObject>(this, SYM_OBJECT) : Hooks.acquireInstance(this)
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

  static acquireInstance(obj: any): RObject {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw misuse('only objects can be reactive')
    let o = Utils.get<RObject>(obj, SYM_OBJECT)
    if (!o) {
      const blank = Hooks.getMeta<any>(Object.getPrototypeOf(obj), SYM_BLANK)
      const initial = new Record(NIL.snapshot, NIL, {...blank})
      Utils.set(initial.data, SYM_OBJECT, o)
      Snapshot.freezeRecord(initial)
      o = new RObject(obj, obj, Hooks.proxy, initial, obj.constructor.name)
      Utils.set(obj, SYM_OBJECT, o)
      // Hooks.decorateField(false, {kind: Kind.Stateful}, obj, UNMOUNT)
    }
    return o
  }

  static createInstance(stateless: any, blank: any, hint: string): RObject {
    const ctx = Snapshot.writable()
    const o = new RObject(stateless, undefined, Hooks.proxy, NIL, hint)
    ctx.write(o, SYM_OBJECT, blank)
    return o
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
      if (Array.isArray(v)) {
        if (!Object.isFrozen(v)) {
          if (!observable.isComputed)
            observable.value = new Proxy(CopyOnWriteArray.seal(proxy, m, v), CopyOnWriteProxy.global)
          else
            Object.freeze(v) // just freeze without copy-on-write hooks
        }
      }
      else if (v instanceof Set) {
        if (!Object.isFrozen(v)) {
          if (!observable.isComputed)
            observable.value = new Proxy(CopyOnWriteSet.seal(proxy, m, v), CopyOnWriteProxy.global)
          else
            Utils.freezeSet(v) // just freeze without copy-on-write hooks
        }
      }
      else if (v instanceof Map) {
        if (!Object.isFrozen(v)) {
          if (!observable.isComputed)
            observable.value = new Proxy(CopyOnWriteMap.seal(proxy, m, v), CopyOnWriteProxy.global)
          else
            Utils.freezeMap(v) // just freeze without copy-on-write hooks
        }
      }
    }
  }
}
