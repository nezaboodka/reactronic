// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef, RT_CACHE } from './Utils';
import { CopyOnWriteArray, Binding } from './Binding.CopyOnWriteArray';
import { CopyOnWriteSet } from './Binding.CopyOnWriteSet';
import { CopyOnWriteMap } from './Binding.CopyOnWriteMap';
import { Record, F, RT_UNMOUNT } from './Record';
import { Handle, RT_HANDLE } from './Handle';
import { Snapshot } from './Snapshot';
import { Reactivity, Kind, Reentrance } from '../api/Reactivity';
import { Monitor } from '../api/Monitor';
import { Status } from '../api/Status';
import { Trace } from '../api/Trace';

// Reactivity

const RT_RX_TABLE: unique symbol = Symbol("RT:RX:TABLE");
const RT_RX_CLASS: unique symbol = Symbol("RT:RX:CLASS");
const RT_RX_TRIGGERS: unique symbol = Symbol("RT:RX:TRIGGERS");

const BLANK_RX_TABLE = Object.freeze({});
const DEFAULT_RX: Reactivity = Object.freeze({
  kind: Kind.Stateless,
  latency: -2, // never
  reentrance: Reentrance.PreventWithError,
  monitor: null,
  trace: undefined,
});

export class Rx implements Reactivity {
  readonly body: Function;
  readonly kind: Kind;
  readonly latency: number;
  readonly reentrance: Reentrance;
  readonly monitor: Monitor | null;
  readonly trace?: Partial<Trace>;
  static readonly DEFAULT = Object.freeze(new Rx(undef, {body: undef, ...DEFAULT_RX}, {}, false));

  constructor(body: Function | undefined, existing: Rx, patch: Partial<Rx>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body;
    this.kind = merge(DEFAULT_RX.kind, existing.kind, patch.kind, implicit);
    this.latency = merge(DEFAULT_RX.latency, existing.latency, patch.latency, implicit);
    this.reentrance = merge(DEFAULT_RX.reentrance, existing.reentrance, patch.reentrance, implicit);
    this.monitor = merge(DEFAULT_RX.monitor, existing.monitor, patch.monitor, implicit);
    this.trace = merge(DEFAULT_RX.trace, existing.trace, patch.trace, implicit);
    Object.freeze(this);
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing;
}

// Hooks

export class Hooks implements ProxyHandler<Handle> {
  static readonly proxy: Hooks = new Hooks();

  getPrototypeOf(h: Handle): object | null {
    return Reflect.getPrototypeOf(h.stateless);
  }

  get(h: Handle, prop: PropertyKey, receiver: any): any {
    let value: any;
    const rx: Rx | undefined = Hooks.getReactivity(h.stateless, prop);
    if (!rx || (rx.body === decoratedfield && rx.kind !== Kind.Stateless)) { // versioned state
      const r: Record = Snapshot.readable().read(h);
      value = r.data[prop];
      if (value === undefined && !r.data.hasOwnProperty(prop)) {
        value = Reflect.get(h.stateless, prop, receiver);
        if (value === undefined) // treat unknown fields as stateful
          Record.markViewed(r, prop);
      }
      else
        Record.markViewed(r, prop);
    }
    else
      value = Reflect.get(h.stateless, prop, receiver);
    return value;
  }

  set(h: Handle, prop: PropertyKey, value: any, receiver: any): boolean {
    const rx: Rx | undefined = Hooks.getReactivity(h.stateless, prop);
    if (!rx || (rx.body === decoratedfield && rx.kind !== Kind.Stateless)) { // versioned state
      const r: Record = Snapshot.writable().tryWrite(h, prop, value);
      if (r !== Record.blank) { // blank when r.data[prop] === value, thus creation of changing record was skipped
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
    const r: Record = Snapshot.readable().read(h);
    const pd = Reflect.getOwnPropertyDescriptor(r.data, prop);
    if (pd)
      pd.configurable = pd.writable = true;
    return pd;
  }

  ownKeys(h: Handle): PropertyKey[] {
    // TODO: Better implementation to avoid filtering
    const r: Record = Snapshot.readable().read(h);
    const result = [];
    for (const prop of Object.getOwnPropertyNames(r.data)) {
      const value = r.data[prop];
      if (typeof(value) !== "object" || value.constructor.name !== "CacheResult")
        result.push(prop);
    }
    return result;
  }

  static decorateClass(implicit: boolean, rx: Partial<Reactivity>, origCtor: any): any {
    let ctor: any = origCtor;
    const stateful = rx.kind !== undefined && rx.kind !== Kind.Stateless;
    const triggers: Map<PropertyKey, Rx> | undefined = Hooks.getReactivityTable(ctor.prototype)[RT_RX_TRIGGERS];
    if (stateful) {
      ctor = function(this: any, ...args: any[]): any {
        const stateless = new origCtor(...args);
        const h: Handle = Hooks.createHandle(stateful, stateless, undefined);
        if (triggers)
          triggers.forEach((rx, prop) => {
            const status: Status<any> = h.proxy[prop][RT_CACHE];
            status.invalidate();
          });
        return h.proxy;
      };
      Object.setPrototypeOf(ctor, Object.getPrototypeOf(origCtor)); // preserve prototype
      Object.defineProperties(ctor, Object.getOwnPropertyDescriptors(origCtor)); // preserve static definitions
    }
    Hooks.configureReactivity(ctor.prototype, RT_RX_CLASS, decoratedclass, rx, implicit);
    return ctor;
  }

  static decorateField(implicit: boolean, rx: Partial<Reactivity>, proto: any, prop: PropertyKey): any {
    rx = Hooks.configureReactivity(proto, prop, decoratedfield, rx, implicit);
    if (rx.kind !== Kind.Stateless) {
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

  static decorateMethod(implicit: boolean, rx: Partial<Reactivity>, proto: any, method: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true;
    const configurable: boolean = true;
    const rxOfMethod = Hooks.configureReactivity(proto, method, pd.value, rx, implicit);
    const get = function(this: any): any {
      const rxOfClass: Rx = Hooks.getReactivity(Object.getPrototypeOf(this), RT_RX_CLASS) || Rx.DEFAULT;
      const h: Handle = rxOfClass.kind !== Kind.Stateless ? Utils.get(this, RT_HANDLE) : Hooks.acquireHandle(this);
      const value = Hooks.createCacheTrap(h, method, rxOfMethod);
      Object.defineProperty(h.stateless, method, { value, enumerable, configurable });
      return value;
    };
    return Object.defineProperty(proto, method, { get, enumerable, configurable });
  }

  private static getReactivity(proto: any, prop: PropertyKey): Rx | undefined {
    return Hooks.getReactivityTable(proto)[prop];
  }

  private static configureReactivity(proto: any, prop: PropertyKey, body: Function | undefined, rx: Partial<Rx>, implicit: boolean): Rx {
    const rxTable: any = Hooks.acquireReactivityTable(proto);
    const existing: Rx = rxTable[prop] || Rx.DEFAULT;
    const result = rxTable[prop] = new Rx(body, existing, rx, implicit);
    if (result.kind === Kind.Trigger && result.latency > -2) {
      let triggers: Map<PropertyKey, Rx> | undefined = rxTable[RT_RX_TRIGGERS];
      if (!triggers)
        triggers = rxTable[RT_RX_TRIGGERS] = new Map<PropertyKey, Rx>();
      triggers.set(prop, result);
    }
    else if (existing.kind === Kind.Trigger && existing.latency > -2) {
      const triggers: Map<PropertyKey, Rx> | undefined = rxTable[RT_RX_TRIGGERS];
      if (triggers)
        triggers.delete(prop);
    }
    return result;
  }

  private static acquireReactivityTable(proto: any): any {
    let rxTable: any = proto[RT_RX_TABLE];
    if (!proto.hasOwnProperty(RT_RX_TABLE)) {
      rxTable = Object.setPrototypeOf({}, rxTable || {});
      Utils.set(proto, RT_RX_TABLE, rxTable);
    }
    return rxTable;
  }

  static getReactivityTable(proto: any): any {
    return proto[RT_RX_TABLE] || /* istanbul ignore next */ BLANK_RX_TABLE;
  }

  static acquireHandle(obj: any): Handle {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw new Error("only objects can be reactive");
    let h: Handle = Utils.get(obj, RT_HANDLE);
    if (!h) {
      h = new Handle(obj, obj, Hooks.proxy);
      Utils.set(obj, RT_HANDLE, h);
      Hooks.decorateField(false, {kind: Kind.Stateful}, obj, RT_UNMOUNT);
    }
    return h;
  }

  static createHandle(stateful: boolean, stateless: any, proxy: any): Handle {
    const h = new Handle(stateless, proxy, Hooks.proxy);
    const r = Snapshot.writable().write(h, RT_HANDLE, RT_HANDLE);
    Utils.set(r.data, RT_HANDLE, h);
    initRecordData(h, stateful, stateless, r);
    return h;
  }

  /* istanbul ignore next */
  static createCacheTrap = function(h: Handle, prop: PropertyKey, rx: Rx): F<any> {
     throw new Error("createCacheTrap should never be called");
  };
}

function initRecordData(h: Handle, stateful: boolean, stateless: any, record: Record): void {
  const rxTable = Hooks.getReactivityTable(Object.getPrototypeOf(stateless));
  const r = Snapshot.writable().write(h, RT_HANDLE, RT_HANDLE);
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
   throw new Error("decoratedfield should never be called");
}

/* istanbul ignore next */
function decoratedclass(...args: any[]): never {
  throw new Error("decoratedclass should never be called");
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
