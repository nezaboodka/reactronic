// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { misuse } from './Dbg'
import { Utils, undef, R_CACHE } from './Utils'
import { CopyOnWriteArray, Binding } from './Binding.CopyOnWriteArray'
import { CopyOnWriteSet } from './Binding.CopyOnWriteSet'
import { CopyOnWriteMap } from './Binding.CopyOnWriteMap'
import { Record, PropKey, PropValue, F, R_UNMOUNT } from './Record'
import { Handle, R_HANDLE } from './Handle'
import { Snapshot, Hint } from './Snapshot'
import { Config, Kind, Reentrance } from '../api/Config'
import { Monitor } from '../api/Monitor'
import { Cache } from '../api/Cache'
import { Trace } from '../api/Trace'

// Stateful

export class Stateful {
  constructor() {
    const h = Hooks.createHandle(true, this, undefined, new.target.name)
    if (!Hooks.triggersAutoStartDisabled) {
      const triggers: Map<PropKey, Cfg> | undefined = Hooks.getConfigTable(new.target.prototype)[R_TRIGGERS]
      if (triggers)
        triggers.forEach((rx, prop) =>
          (h.proxy[prop][R_CACHE] as Cache<any>).invalidate())
    }
    return h.proxy
  }

  toString(): string {
    const h = Utils.get<Handle>(this, R_HANDLE)
    return Hint.handle(h)
  }
}

// Config

const R_TABLE: unique symbol = Symbol("R:TABLE")
const R_CLASS: unique symbol = Symbol("R:CLASS")
const R_TRIGGERS: unique symbol = Symbol("R:TRIGGERS")

const BLANK_TABLE = Object.freeze({})
const DEFAULT_STATELESS_CONFIG: Config = Object.freeze({
  kind: Kind.Stateless,
  latency: -2, // never
  reentrance: Reentrance.PreventWithError,
  cachedArgs: false,
  monitor: null,
  trace: undefined,
})
const DEFAULT_STATEFUL_CONFIG: Config = Object.freeze({
  kind: Kind.Stateful,
  latency: -2, // never
  reentrance: Reentrance.PreventWithError,
  cachedArgs: false,
  monitor: null,
  trace: undefined,
})

export class Cfg implements Config {
  readonly body: Function
  readonly kind: Kind
  readonly latency: number
  readonly reentrance: Reentrance
  readonly cachedArgs: boolean
  readonly monitor: Monitor | null
  readonly trace?: Partial<Trace>
  static readonly STATEFUL = Object.freeze(new Cfg(undef, {body: undef, ...DEFAULT_STATEFUL_CONFIG}, {}, false))
  static readonly STATELESS = Object.freeze(new Cfg(undef, {body: undef, ...DEFAULT_STATELESS_CONFIG}, {}, false))

  constructor(body: Function | undefined, existing: Cfg, patch: Partial<Cfg>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body
    this.kind = merge(DEFAULT_STATELESS_CONFIG.kind, existing.kind, patch.kind, implicit)
    this.latency = merge(DEFAULT_STATELESS_CONFIG.latency, existing.latency, patch.latency, implicit)
    this.reentrance = merge(DEFAULT_STATELESS_CONFIG.reentrance, existing.reentrance, patch.reentrance, implicit)
    this.cachedArgs = merge(DEFAULT_STATELESS_CONFIG.cachedArgs, existing.cachedArgs, patch.cachedArgs, implicit)
    this.monitor = merge(DEFAULT_STATELESS_CONFIG.monitor, existing.monitor, patch.monitor, implicit)
    this.trace = merge(DEFAULT_STATELESS_CONFIG.trace, existing.trace, patch.trace, implicit)
    Object.freeze(this)
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing
}

// Hooks

export class Hooks implements ProxyHandler<Handle> {
  static triggersAutoStartDisabled: boolean = false
  static performanceWarningThreshold: number = 10
  static readonly proxy: Hooks = new Hooks()

  getPrototypeOf(h: Handle): object | null {
    return Reflect.getPrototypeOf(h.stateless)
  }

  get(h: Handle, prop: PropKey, receiver: any): any {
    let result: any
    const rt: Cfg | undefined = Hooks.getConfig(h.stateless, prop)
    if (!rt || (rt.body === decoratedfield && rt.kind !== Kind.Stateless)) { // versioned state
      const r: Record = Snapshot.readable().read(h)
      result = r.data[prop]
      if (result instanceof PropValue) {
        Record.markViewed(r, prop, result, false)
        result = result.value
      }
      else if (prop === R_HANDLE) {
        // do nothing, just return handle
      }
      else {
        result = Reflect.get(h.stateless, prop, receiver)
        if (result === undefined)
          // Record.markViewed(r, prop, false); // treat undefined fields as stateful
          throw misuse(`unassigned properties are not supported: ${Hint.record(r, prop)}`)
      }
    }
    else
      result = Reflect.get(h.stateless, prop, receiver)
    return result
  }

  set(h: Handle, prop: PropKey, value: any, receiver: any): boolean {
    const rt: Cfg | undefined = Hooks.getConfig(h.stateless, prop)
    if (!rt || (rt.body === decoratedfield && rt.kind !== Kind.Stateless)) { // versioned state
      const r: Record = Snapshot.writable().write(h, prop, value)
      const curr = r.data[prop] as PropValue
      const prev = r.prev.record.data[prop] as PropValue
      const changed = prev === undefined || prev.value !== value
      if (changed) {
        if (prev === curr)
          r.data[prop] = new PropValue(value)
        else
          curr.value = value
      }
      else if (prev !== curr)
        r.data[prop] = prev // restore previous value
      Record.markChanged(r, prop, changed, value)
    }
    else
      h.stateless[prop] = value
    return true
  }

  getOwnPropertyDescriptor(h: Handle, prop: PropKey): PropertyDescriptor | undefined {
    const r: Record = Snapshot.readable().read(h)
    const pd = Reflect.getOwnPropertyDescriptor(r.data, prop)
    if (pd)
      pd.configurable = pd.writable = true
    return pd
  }

  ownKeys(h: Handle): PropKey[] {
    // TODO: Better implementation to avoid filtering
    const r: Record = Snapshot.readable().read(h)
    const result = []
    for (const prop of Object.getOwnPropertyNames(r.data)) {
      const value = r.data[prop]
      if (typeof(value) !== "object" || value.constructor.name !== "CacheResult")
        result.push(prop)
    }
    return result
  }

  static decorateClass(implicit: boolean, rt: Partial<Config>, origCtor: any): any {
    let ctor: any = origCtor
    const stateful = rt.kind !== undefined && rt.kind !== Kind.Stateless
    const triggers: Map<PropKey, Cfg> | undefined = Hooks.getConfigTable(ctor.prototype)[R_TRIGGERS]
    if (stateful) {
      ctor = class extends origCtor {
        constructor(...args: any[]) {
          super(...args)
          const self: any = this
          const h: Handle = self[R_HANDLE] || Hooks.createHandleByDecoratedClass(stateful, self, undefined, origCtor.name)
          if (self.constructor === ctor)
            h.hint = origCtor.name
          if (triggers && !Hooks.triggersAutoStartDisabled)
            triggers.forEach((rx, prop) =>
              (h.proxy[prop][R_CACHE] as Cache<any>).invalidate())
          return h.proxy
        }
      }
      Hooks.configure(ctor.prototype, R_CLASS, decoratedclass, rt, implicit)
    }
    return ctor
  }

  static decorateClassOld(implicit: boolean, rt: Partial<Config>, origCtor: any): any {
    let ctor: any = origCtor
    const stateful = rt.kind !== undefined && rt.kind !== Kind.Stateless
    const triggers: Map<PropKey, Cfg> | undefined = Hooks.getConfigTable(ctor.prototype)[R_TRIGGERS]
    if (stateful) {
      ctor = function(this: any, ...args: any[]): any {
        const stateless = new origCtor(...args)
        const h: Handle = stateless instanceof Proxy
          ? stateless[R_HANDLE] || Hooks.createHandleByDecoratedClass(stateful, stateless, undefined, origCtor.name)
          : Hooks.createHandleByDecoratedClass(stateful, stateless, undefined, origCtor.name)
        if (triggers)
          triggers.forEach((rx, prop) => {
            const cache: Cache<any> = h.proxy[prop][R_CACHE]
            cache.invalidate()
          })
        return h.proxy
      }
      Object.setPrototypeOf(ctor, Object.getPrototypeOf(origCtor)) // preserve prototype
      Object.defineProperties(ctor, Object.getOwnPropertyDescriptors(origCtor)) // preserve static definitions
    }
    Hooks.configure(ctor.prototype, R_CLASS, decoratedclass, rt, implicit)
    return ctor
  }

  static decorateField(implicit: boolean, rt: Partial<Config>, proto: any, prop: PropKey): any {
    rt = Hooks.configure(proto, prop, decoratedfield, rt, implicit)
    if (rt.kind !== Kind.Stateless) {
      const get = function(this: any): any {
        const h: Handle = Hooks.acquireHandle(this)
        return Hooks.proxy.get(h, prop, this)
      };
      const set = function(this: any, value: any): boolean {
        const h: Handle = Hooks.acquireHandle(this)
        return Hooks.proxy.set(h, prop, value, this)
      };
      const enumerable = true
      const configurable = false
      return Object.defineProperty(proto, prop, { get, set, enumerable, configurable })
    }
  }

  static decorateMethod(implicit: boolean, rt: Partial<Config>, proto: any, method: PropKey, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true
    const configurable: boolean = true
    const methodConfig = Hooks.configure(proto, method, pd.value, rt, implicit)
    const get = function(this: any): any {
      const p = Object.getPrototypeOf(this)
      const classConfig: Cfg = Hooks.getConfig(p, R_CLASS) || (this instanceof Stateful ? Cfg.STATEFUL : Cfg.STATELESS)
      const h: Handle = classConfig.kind !== Kind.Stateless ? Utils.get<Handle>(this, R_HANDLE) : Hooks.acquireHandle(this)
      const value = Hooks.createCacheTrap(h, method, methodConfig)
      Object.defineProperty(h.stateless, method, { value, enumerable, configurable })
      return value
    }
    return Object.defineProperty(proto, method, { get, enumerable, configurable })
  }

  private static getConfig(proto: any, prop: PropKey): Cfg | undefined {
    return Hooks.getConfigTable(proto)[prop]
  }

  private static configure(proto: any, prop: PropKey, body: Function | undefined, rt: Partial<Cfg>, implicit: boolean): Cfg {
    const configTable: any = Hooks.acquireConfigTable(proto)
    const existing: Cfg = configTable[prop] || Cfg.STATELESS
    const result = configTable[prop] = new Cfg(body, existing, rt, implicit)
    if (result.kind === Kind.Trigger && result.latency > -2) {
      let triggers: Map<PropKey, Cfg> | undefined = configTable[R_TRIGGERS]
      if (!triggers)
        triggers = configTable[R_TRIGGERS] = new Map<PropKey, Cfg>()
      triggers.set(prop, result)
    }
    else if (existing.kind === Kind.Trigger && existing.latency > -2) {
      const triggers: Map<PropKey, Cfg> | undefined = configTable[R_TRIGGERS]
      if (triggers)
        triggers.delete(prop)
    }
    return result
  }

  private static acquireConfigTable(proto: any): any {
    let rxTable: any = proto[R_TABLE]
    if (!proto.hasOwnProperty(R_TABLE)) {
      rxTable = Object.setPrototypeOf({}, rxTable || {})
      Utils.set(proto, R_TABLE, rxTable)
    }
    return rxTable
  }

  static getConfigTable(proto: any): any {
    return proto[R_TABLE] || /* istanbul ignore next */ BLANK_TABLE
  }

  static acquireHandle(obj: any): Handle {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw misuse("only objects can be reactive")
    let h = Utils.get<Handle>(obj, R_HANDLE)
    if (!h) {
      h = new Handle(obj, obj, obj.constructor.name, Hooks.proxy)
      Utils.set(obj, R_HANDLE, h)
      Hooks.decorateField(false, {kind: Kind.Stateful}, obj, R_UNMOUNT)
    }
    return h
  }

  static createHandle(stateful: boolean, stateless: any, proxy: any, hint: string): Handle {
    const h = new Handle(stateless, proxy, hint, Hooks.proxy)
    Snapshot.writable().write(h, "<RT:HANDLE>", R_HANDLE)
    return h
  }

  static createHandleByDecoratedClass(stateful: boolean, stateless: any, proxy: any, hint: string): Handle {
    const h = new Handle(stateless, proxy, hint, Hooks.proxy)
    const r = Snapshot.writable().write(h, "<RT:HANDLE>", R_HANDLE)
    initRecordData(h, stateful, stateless, r)
    return h
  }

  /* istanbul ignore next */
  static createCacheTrap = function(h: Handle, prop: PropKey, rt: Cfg): F<any> {
     throw misuse("createCacheTrap should never be called")
  }
}

function initRecordData(h: Handle, stateful: boolean, stateless: any, record: Record): void {
  const rxTable = Hooks.getConfigTable(Object.getPrototypeOf(stateless))
  const r = Snapshot.writable().write(h, "<RT:HANDLE>", R_HANDLE)
  for (const prop of Object.getOwnPropertyNames(stateless))
    initRecordProp(stateful, rxTable, prop, r, stateless)
  for (const prop of Object.getOwnPropertySymbols(stateless)) /* istanbul ignore next */
    initRecordProp(stateful, rxTable, prop, r, stateless)
}

function initRecordProp(stateful: boolean, rxTable: any, prop: PropKey, r: Record, stateless: any): void {
  if (stateful && rxTable[prop] !== false) {
    const value = stateless[prop]
    r.data[prop] = new PropValue(value)
    Record.markChanged(r, prop, true, value)
  }
}

/* istanbul ignore next */
function decoratedfield(...args: any[]): never {
   throw misuse("decoratedfield should never be called")
}

/* istanbul ignore next */
function decoratedclass(...args: any[]): never {
  throw misuse("decoratedclass should never be called")
}

export class CopyOnWrite implements ProxyHandler<Binding<any>> {
  static readonly global: CopyOnWrite = new CopyOnWrite()

  get(binding: Binding<any>, prop: PropKey, receiver: any): any {
    const a: any = binding.readable(receiver)
    return a[prop]
  }

  set(binding: Binding<any>, prop: PropKey, value: any, receiver: any): boolean {
    const a: any = binding.writable(receiver)
    return a[prop] = value
  }

  static seal(pv: PropValue, proxy: any, prop: PropKey): void {
    const v = pv.value
    if (Array.isArray(v)) {
      if (!Object.isFrozen(v)) {
        if (pv.copyOnWriteMode)
          pv.value = new Proxy(CopyOnWriteArray.seal(proxy, prop, v), CopyOnWrite.global)
        else
          Object.freeze(v) // just freeze without copy-on-write hooks
      }
    }
    else if (v instanceof Set) {
      if (!Object.isFrozen(v)) {
        if (pv.copyOnWriteMode)
          pv.value = new Proxy(CopyOnWriteSet.seal(proxy, prop, v), CopyOnWrite.global)
        else
          Utils.freezeSet(v) // just freeze without copy-on-write hooks
      }
    }
    else if (v instanceof Map) {
      if (!Object.isFrozen(v)) {
        if (pv.copyOnWriteMode)
          pv.value = new Proxy(CopyOnWriteMap.seal(proxy, prop, v), CopyOnWrite.global)
        else
          Utils.freezeMap(v) // just freeze without copy-on-write hooks
      }
    }
  }
}
