// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.

// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Utils, undef } from './Utils';
import { CopyOnWriteArray, Binding } from './Binding.CopyOnWriteArray';
import { CopyOnWriteSet } from './Binding.CopyOnWriteSet';
import { CopyOnWriteMap } from './Binding.CopyOnWriteMap';
import { Record, F, RT_UNMOUNT } from './Record';
import { Handle, RT_HANDLE } from './Handle';
import { Snapshot } from './Snapshot';
import { Config, Renewal, Renew, ReentrantCalls, SeparatedFrom } from '../public/Config';
import { Monitor } from '../public/Monitor';
import { Trace } from '../public/Trace';

// Config

export const RT_CONFIG: unique symbol = Symbol("RT:CONFIG");
export const RT_CLASS: unique symbol = Symbol("RT:CLASS");

const BLANK_CONFIG_TABLE = {};
const DEFAULT: Config = {
  stateful: false,
  renewal: Renew.NoCache,
  reentrant: ReentrantCalls.WaitAndRestart,
  separated: SeparatedFrom.Reaction,
  monitor: null,
  trace: undefined,
};

export class ConfigRecord implements Config {
  readonly body: Function;
  readonly stateful: boolean;
  readonly renewal: Renewal;
  readonly reentrant: ReentrantCalls;
  readonly separated: SeparatedFrom;
  readonly monitor: Monitor | null;
  readonly trace?: Partial<Trace>;
  static default = new ConfigRecord(undef, {body: undef, ...DEFAULT}, {}, false);

  constructor(body: Function | undefined, existing: ConfigRecord, patch: Partial<ConfigRecord>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body;
    this.stateful = merge(DEFAULT.stateful, existing.stateful, patch.stateful, implicit);
    this.renewal = merge(DEFAULT.renewal, existing.renewal, patch.renewal, implicit);
    this.reentrant = merge(DEFAULT.reentrant, existing.reentrant, patch.reentrant, implicit);
    this.separated = merge(DEFAULT.separated, existing.separated, patch.separated, implicit);
    this.monitor = merge(DEFAULT.monitor, existing.monitor, patch.monitor, implicit);
    this.trace = merge(DEFAULT.trace, existing.trace, patch.trace, implicit);
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
    const config: ConfigRecord | undefined = Hooks.getConfig(h.stateless, prop);
    if (!config || (config.body === decoratedfield && config.stateful)) { // versioned state
      const r: Record = Snapshot.readable().read(h);
      value = r.data[prop];
      if (value === undefined && !r.data.hasOwnProperty(prop))
        value = Reflect.get(h.stateless, prop, receiver);
      else
        Record.markViewed(r, prop);
    }
    else
      value = Reflect.get(h.stateless, prop, receiver);
    return value;
  }

  set(h: Handle, prop: PropertyKey, value: any, receiver: any): boolean {
    const config: ConfigRecord | undefined = Hooks.getConfig(h.stateless, prop);
    if (!config || (config.body === decoratedfield && config.stateful)) { // versioned state
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

  static decorateClass(implicit: boolean, config: Partial<Config>, origCtor: any): any {
    let ctor: any = origCtor;
    const stateful = config.stateful || false;
    if (stateful) {
      ctor = function(this: any, ...args: any[]): any {
        const stateless = new origCtor(...args);
        const h: Handle = Hooks.createHandle(stateful, stateless, undefined);
        return h.proxy;
      };
      Object.setPrototypeOf(ctor, Object.getPrototypeOf(origCtor)); // preserve prototype
      Object.defineProperties(ctor, Object.getOwnPropertyDescriptors(origCtor)); // preserve static definitions
    }
    Hooks.applyConfig(ctor.prototype, RT_CLASS, decoratedclass, config, implicit);
    return ctor;
  }

  static decorateField(implicit: boolean, config: Partial<Config>, target: any, prop: PropertyKey): any {
    config = Hooks.applyConfig(target, prop, decoratedfield, config, implicit);
    if (config.stateful) {
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
      return Object.defineProperty(target, prop, { get, set, enumerable, configurable });
    }
  }

  static decorateMethod(implicit: boolean, config: Partial<Config>, type: any, method: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true;
    const configurable: boolean = true;
    const methodConfig = Hooks.applyConfig(type, method, pd.value, config, implicit);
    const get = function(this: any): any {
      const classConfig: ConfigRecord = Hooks.getConfig(Object.getPrototypeOf(this), RT_CLASS) || ConfigRecord.default;
      const h: Handle = classConfig.stateful ? Utils.get(this, RT_HANDLE) : Hooks.acquireHandle(this);
      const value = Hooks.createMethodCacheTrap(h, method, methodConfig);
      Object.defineProperty(h.stateless, method, { value, enumerable, configurable });
      return value;
    };
    return Object.defineProperty(type, method, { get, enumerable, configurable });
  }

  private static applyConfig(target: any, prop: PropertyKey, body: Function | undefined, config: Partial<ConfigRecord>, implicit: boolean): ConfigRecord {
    const table: any = Hooks.acquireConfigTable(target);
    const existing: ConfigRecord = table[prop] || ConfigRecord.default;
    const result = table[prop] = new ConfigRecord(body, existing, config, implicit);
    return result;
  }

  private static acquireConfigTable(target: any): any {
    let table: any = target[RT_CONFIG];
    if (!target.hasOwnProperty(RT_CONFIG)) {
      table = Object.setPrototypeOf({}, table || {});
      Utils.set(target, RT_CONFIG, table);
    }
    return table;
  }

  static getConfigTable(target: any): any {
    return target[RT_CONFIG] || /* istanbul ignore next */ BLANK_CONFIG_TABLE;
  }

  static getConfig(target: any, prop: PropertyKey): ConfigRecord | undefined {
    return Hooks.getConfigTable(target)[prop];
  }

  static acquireHandle(obj: any): Handle {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw new Error("only objects can be reactive");
    let h: Handle = Utils.get(obj, RT_HANDLE);
    if (!h) {
      h = new Handle(obj, obj, Hooks.proxy);
      Utils.set(obj, RT_HANDLE, h);
      Hooks.decorateField(false, {stateful: true}, obj, RT_UNMOUNT);
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
  static createMethodCacheTrap = function(h: Handle, prop: PropertyKey, config: ConfigRecord): F<any> {
     throw new Error("createMethodCacheTrap should never be called");
  };
}

function initRecordData(h: Handle, stateful: boolean, stateless: any, record: Record): void {
  const configTable = Hooks.getConfigTable(Object.getPrototypeOf(stateless));
  const r = Snapshot.writable().write(h, RT_HANDLE, RT_HANDLE);
  for (const prop of Object.getOwnPropertyNames(stateless))
    initRecordProp(stateful, configTable, prop, r, stateless);
  for (const prop of Object.getOwnPropertySymbols(stateless)) /* istanbul ignore next */
    initRecordProp(stateful, configTable, prop, r, stateless);
}

function initRecordProp(stateful: boolean, configTable: any, prop: PropertyKey, r: Record, stateless: any): void {
  if (stateful && configTable[prop] !== false) {
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
