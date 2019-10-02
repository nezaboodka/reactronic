// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { misuse } from './Dbg';
import { Utils, undef, RT_CACHE } from './Utils';
import { CopyOnWriteArray, Binding } from './Binding.CopyOnWriteArray';
import { CopyOnWriteSet } from './Binding.CopyOnWriteSet';
import { CopyOnWriteMap } from './Binding.CopyOnWriteMap';
import { Record, F, RT_UNMOUNT } from './Record';
import { Handle, RT_HANDLE } from './Handle';
import { Snapshot } from './Snapshot';
import { Config, Kind, Reentrance } from '../api/Config';
import { Monitor } from '../api/Monitor';
import { Cache } from '../api/Cache';
import { Trace } from '../api/Trace';

// Stateful

export class Stateful {
  constructor() {
    const h = Hooks.createHandle(true, this, undefined, new.target.name);
    const triggers: Map<PropertyKey, Cfg> | undefined = Hooks.getConfigTable(new.target.prototype)[RT_TRIGGERS];
    if (triggers && !Hooks.triggersAutoStartDisabled)
      triggers.forEach((rx, prop) =>
        (h.proxy[prop][RT_CACHE] as Cache<any>).invalidate());
    return h.proxy;
  }
}

// Config

const RT_TABLE: unique symbol = Symbol("RT:TABLE");
const RT_CLASS: unique symbol = Symbol("RT:CLASS");
const RT_TRIGGERS: unique symbol = Symbol("RT:TRIGGERS");

const RT_BLANK_TABLE = Object.freeze({});
const RT_DEFAULT_CONFIG: Config = Object.freeze({
  kind: Kind.Stateless,
  latency: -2, // never
  reentrance: Reentrance.PreventWithError,
  monitor: null,
  trace: undefined,
});

export class Cfg implements Config {
  readonly body: Function;
  readonly kind: Kind;
  readonly latency: number;
  readonly reentrance: Reentrance;
  readonly monitor: Monitor | null;
  readonly trace?: Partial<Trace>;
  static readonly DEFAULT = Object.freeze(new Cfg(undef, {body: undef, ...RT_DEFAULT_CONFIG}, {}, false));

  constructor(body: Function | undefined, existing: Cfg, patch: Partial<Cfg>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body;
    this.kind = merge(RT_DEFAULT_CONFIG.kind, existing.kind, patch.kind, implicit);
    this.latency = merge(RT_DEFAULT_CONFIG.latency, existing.latency, patch.latency, implicit);
    this.reentrance = merge(RT_DEFAULT_CONFIG.reentrance, existing.reentrance, patch.reentrance, implicit);
    this.monitor = merge(RT_DEFAULT_CONFIG.monitor, existing.monitor, patch.monitor, implicit);
    this.trace = merge(RT_DEFAULT_CONFIG.trace, existing.trace, patch.trace, implicit);
    Object.freeze(this);
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing;
}

// Hooks

export class Hooks implements ProxyHandler<Handle> {
  static triggersAutoStartDisabled: boolean = false;
  static readonly proxy: Hooks = new Hooks();

  getPrototypeOf(h: Handle): object | null {
    return Reflect.getPrototypeOf(h.stateless);
  }

  get(h: Handle, prop: PropertyKey, receiver: any): any {
    let value: any;
    const rt: Cfg | undefined = Hooks.getConfig(h.stateless, prop);
    if (!rt || (rt.body === decoratedfield && rt.kind !== Kind.Stateless)) { // versioned state
      const r: Record = Snapshot.readable().readable(h);
      value = r.data[prop];
      if (value === undefined && !r.data.hasOwnProperty(prop)) {
        value = Reflect.get(h.stateless, prop, receiver);
        if (value === undefined) // treat undefined fields as stateful
          Record.markViewed(r, prop, false);
      }
      else
        Record.markViewed(r, prop, false);
    }
    else
      value = Reflect.get(h.stateless, prop, receiver);
    return value;
  }

  set(h: Handle, prop: PropertyKey, value: any, receiver: any): boolean {
    const rt: Cfg | undefined = Hooks.getConfig(h.stateless, prop);
    if (!rt || (rt.body === decoratedfield && rt.kind !== Kind.Stateless)) { // versioned state
      const ctx = Snapshot.writable();
      const r: Record = ctx.writable(h, prop, value);
      if (r.snapshot === ctx) { // this condition is false when new value is equal to the old one
        r.data[prop] = value;
        const v: any = r.prev.record.data[prop];
        Record.markChanged(r, prop, v !== value, value);
      }
    }
    else
      h.stateless[prop] = value;
    return true;
  }

  getOwnPropertyDescriptor(h: Handle, prop: PropertyKey): PropertyDescriptor | undefined {
    const r: Record = Snapshot.readable().readable(h);
    const pd = Reflect.getOwnPropertyDescriptor(r.data, prop);
    if (pd)
      pd.configurable = pd.writable = true;
    return pd;
  }

  ownKeys(h: Handle): PropertyKey[] {
    // TODO: Better implementation to avoid filtering
    const r: Record = Snapshot.readable().readable(h);
    const result = [];
    for (const prop of Object.getOwnPropertyNames(r.data)) {
      const value = r.data[prop];
      if (typeof(value) !== "object" || value.constructor.name !== "CacheResult")
        result.push(prop);
    }
    return result;
  }

  static decorateClass(implicit: boolean, rt: Partial<Config>, origCtor: any): any {
    let ctor: any = origCtor;
    const stateful = rt.kind !== undefined && rt.kind !== Kind.Stateless;
    const triggers: Map<PropertyKey, Cfg> | undefined = Hooks.getConfigTable(ctor.prototype)[RT_TRIGGERS];
    if (stateful) {
      ctor = class extends origCtor {
        constructor(...args: any[]) {
          super(...args);
          const self: any = this;
          const h: Handle = self[RT_HANDLE] || Hooks.createHandleByDecoratedClass(stateful, self, undefined, origCtor.name);
          if (self.constructor === ctor)
            h.hint = origCtor.name;
          if (triggers && !Hooks.triggersAutoStartDisabled)
            triggers.forEach((rx, prop) =>
              (h.proxy[prop][RT_CACHE] as Cache<any>).invalidate());
          return h.proxy;
        }
      };
      Hooks.configure(ctor.prototype, RT_CLASS, decoratedclass, rt, implicit);
    }
    return ctor;
  }

  static decorateClassOld(implicit: boolean, rt: Partial<Config>, origCtor: any): any {
    let ctor: any = origCtor;
    const stateful = rt.kind !== undefined && rt.kind !== Kind.Stateless;
    const triggers: Map<PropertyKey, Cfg> | undefined = Hooks.getConfigTable(ctor.prototype)[RT_TRIGGERS];
    if (stateful) {
      ctor = function(this: any, ...args: any[]): any {
        const stateless = new origCtor(...args);
        const h: Handle = stateless instanceof Proxy
          ? stateless[RT_HANDLE] || Hooks.createHandleByDecoratedClass(stateful, stateless, undefined, origCtor.name)
          : Hooks.createHandleByDecoratedClass(stateful, stateless, undefined, origCtor.name);
        if (triggers)
          triggers.forEach((rx, prop) => {
            const cache: Cache<any> = h.proxy[prop][RT_CACHE];
            cache.invalidate();
          });
        return h.proxy;
      };
      Object.setPrototypeOf(ctor, Object.getPrototypeOf(origCtor)); // preserve prototype
      Object.defineProperties(ctor, Object.getOwnPropertyDescriptors(origCtor)); // preserve static definitions
    }
    Hooks.configure(ctor.prototype, RT_CLASS, decoratedclass, rt, implicit);
    return ctor;
  }

  static decorateField(implicit: boolean, rt: Partial<Config>, proto: any, prop: PropertyKey): any {
    rt = Hooks.configure(proto, prop, decoratedfield, rt, implicit);
    if (rt.kind !== Kind.Stateless) {
      const get = function(this: any): any {
        const h: Handle = Hooks.acquireHandle(this);
        return Hooks.proxy.get(h, prop, this);
      };
      const set = function(this: any, value: any): boolean {
        const h: Handle = Hooks.acquireHandle(this);
        return Hooks.proxy.set(h, prop, value, this);
      };
      const enumerable = true;
      const configurable = false;
      return Object.defineProperty(proto, prop, { get, set, enumerable, configurable });
    }
  }

  static decorateMethod(implicit: boolean, rt: Partial<Config>, proto: any, method: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true;
    const configurable: boolean = true;
    const methodConfig = Hooks.configure(proto, method, pd.value, rt, implicit);
    const get = function(this: any): any {
      const classConfig: Cfg = Hooks.getConfig(Object.getPrototypeOf(this), RT_CLASS) || Cfg.DEFAULT;
      const h: Handle = classConfig.kind !== Kind.Stateless ? Utils.get(this, RT_HANDLE) : Hooks.acquireHandle(this);
      const value = Hooks.createCacheTrap(h, method, methodConfig);
      Object.defineProperty(h.stateless, method, { value, enumerable, configurable });
      return value;
    };
    return Object.defineProperty(proto, method, { get, enumerable, configurable });
  }

  private static getConfig(proto: any, prop: PropertyKey): Cfg | undefined {
    return Hooks.getConfigTable(proto)[prop];
  }

  private static configure(proto: any, prop: PropertyKey, body: Function | undefined, rt: Partial<Cfg>, implicit: boolean): Cfg {
    const configTable: any = Hooks.acquireConfigTable(proto);
    const existing: Cfg = configTable[prop] || Cfg.DEFAULT;
    const result = configTable[prop] = new Cfg(body, existing, rt, implicit);
    if (result.kind === Kind.Trigger && result.latency > -2) {
      let triggers: Map<PropertyKey, Cfg> | undefined = configTable[RT_TRIGGERS];
      if (!triggers)
        triggers = configTable[RT_TRIGGERS] = new Map<PropertyKey, Cfg>();
      triggers.set(prop, result);
    }
    else if (existing.kind === Kind.Trigger && existing.latency > -2) {
      const triggers: Map<PropertyKey, Cfg> | undefined = configTable[RT_TRIGGERS];
      if (triggers)
        triggers.delete(prop);
    }
    return result;
  }

  private static acquireConfigTable(proto: any): any {
    let rxTable: any = proto[RT_TABLE];
    if (!proto.hasOwnProperty(RT_TABLE)) {
      rxTable = Object.setPrototypeOf({}, rxTable || {});
      Utils.set(proto, RT_TABLE, rxTable);
    }
    return rxTable;
  }

  static getConfigTable(proto: any): any {
    return proto[RT_TABLE] || /* istanbul ignore next */ RT_BLANK_TABLE;
  }

  static acquireHandle(obj: any): Handle {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw misuse("only objects can be reactive");
    let h: Handle = Utils.get(obj, RT_HANDLE);
    if (!h) {
      h = new Handle(obj, obj, obj.constructor.name, Hooks.proxy);
      Utils.set(obj, RT_HANDLE, h);
      Hooks.decorateField(false, {kind: Kind.Stateful}, obj, RT_UNMOUNT);
    }
    return h;
  }

  static createHandle(stateful: boolean, stateless: any, proxy: any, hint: string): Handle {
    const h = new Handle(stateless, proxy, hint, Hooks.proxy);
    const r = Snapshot.writable().writable(h, RT_HANDLE, RT_HANDLE);
    Utils.set(r.data, RT_HANDLE, h);
    return h;
  }

  static createHandleByDecoratedClass(stateful: boolean, stateless: any, proxy: any, hint: string): Handle {
    const h = new Handle(stateless, proxy, hint, Hooks.proxy);
    const r = Snapshot.writable().writable(h, RT_HANDLE, RT_HANDLE);
    Utils.set(r.data, RT_HANDLE, h);
    initRecordData(h, stateful, stateless, r);
    return h;
  }

  /* istanbul ignore next */
  static createCacheTrap = function(h: Handle, prop: PropertyKey, rt: Cfg): F<any> {
     throw misuse("createCacheTrap should never be called");
  };
}

function initRecordData(h: Handle, stateful: boolean, stateless: any, record: Record): void {
  const rxTable = Hooks.getConfigTable(Object.getPrototypeOf(stateless));
  const r = Snapshot.writable().writable(h, RT_HANDLE, RT_HANDLE);
  for (const prop of Object.getOwnPropertyNames(stateless))
    initRecordProp(stateful, rxTable, prop, r, stateless);
  for (const prop of Object.getOwnPropertySymbols(stateless)) /* istanbul ignore next */
    initRecordProp(stateful, rxTable, prop, r, stateless);
}

function initRecordProp(stateful: boolean, rxTable: any, prop: PropertyKey, r: Record, stateless: any): void {
  if (stateful && rxTable[prop] !== false) {
    const value = r.data[prop] = stateless[prop];
    Record.markChanged(r, prop, true, value);
  }
}

/* istanbul ignore next */
function decoratedfield(...args: any[]): never {
   throw misuse("decoratedfield should never be called");
}

/* istanbul ignore next */
function decoratedclass(...args: any[]): never {
  throw misuse("decoratedclass should never be called");
}

export class CopyOnWrite implements ProxyHandler<Binding<any>> {
  static readonly global: CopyOnWrite = new CopyOnWrite();

  get(binding: Binding<any>, prop: PropertyKey, receiver: any): any {
    const a: any = binding.readable(receiver);
    return a[prop];
  }

  set(binding: Binding<any>, prop: PropertyKey, value: any, receiver: any): boolean {
    const a: any = binding.writable(receiver);
    return a[prop] = value;
  }

  static seal(data: any, proxy: any, prop: PropertyKey): void {
    const value = data[prop];
    if (Array.isArray(value)) {
      if (!Object.isFrozen(value))
        data[prop] = new Proxy(CopyOnWriteArray.seal(proxy, prop, value), CopyOnWrite.global);
    }
    else if (value instanceof Set) {
      if (!Object.isFrozen(value))
        data[prop] = new Proxy(CopyOnWriteSet.seal(proxy, prop, value), CopyOnWrite.global);
    }
    else if (value instanceof Map) {
      if (!Object.isFrozen(value))
        data[prop] = new Proxy(CopyOnWriteMap.seal(proxy, prop, value), CopyOnWrite.global);
    }
  }
}
