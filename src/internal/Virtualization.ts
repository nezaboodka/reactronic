import { Utils, undef } from "./Utils";
import { CopyOnWriteArray, Binding } from "./Binding.CopyOnWriteArray";
import { CopyOnWriteSet } from "./Binding.CopyOnWriteSet";
import { CopyOnWriteMap } from "./Binding.CopyOnWriteMap";
import { Record, F, RT_UNMOUNT } from "./Record";
import { Handle, RT_HANDLE } from "./Handle";
import { Snapshot } from "./Snapshot";
import { Config, Mode, Latency, Renew, ReentrantCall, SeparateFrom } from "../Config";
import { Monitor } from "../Monitor";

// Config

export const RT_CONFIG: unique symbol = Symbol("RT:CONFIG");
export const RT_CLASS: unique symbol = Symbol("RT:CLASS");

const EMPTY_CONFIG_TABLE = {};
const DEFAULT: Config = {
  mode: Mode.Stateless,
  latency: Renew.NoCache,
  reentrant: ReentrantCall.WaitAndRestart,
  separate: SeparateFrom.Reaction,
  monitor: null,
  tracing: 0,
};

export class ConfigRecord implements Config {
  readonly body: Function;
  readonly mode: Mode;
  readonly latency: Latency;
  readonly reentrant: ReentrantCall;
  readonly separate: SeparateFrom;
  readonly monitor: Monitor | null;
  readonly tracing: number;
  static default = new ConfigRecord(undef, {body: undef, ...DEFAULT}, {}, false);

  constructor(body: Function | undefined, existing: ConfigRecord, patch: Partial<ConfigRecord>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body;
    this.mode = merge(DEFAULT.mode, existing.mode, patch.mode, implicit);
    this.latency = merge(DEFAULT.latency, existing.latency, patch.latency, implicit);
    this.reentrant = merge(DEFAULT.reentrant, existing.reentrant, patch.reentrant, implicit);
    this.separate = merge(DEFAULT.separate, existing.separate, patch.separate, implicit);
    this.monitor = merge(DEFAULT.monitor, existing.monitor, patch.monitor, implicit);
    this.tracing = merge(DEFAULT.tracing, existing.tracing, patch.tracing, implicit);
    Object.freeze(this);
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing;
}

// Virtualization

export class Virt implements ProxyHandler<Handle> {
  static readonly proxy: Virt = new Virt();

  getPrototypeOf(h: Handle): object | null {
    return Reflect.getPrototypeOf(h.stateless);
  }

  get(h: Handle, prop: PropertyKey, receiver: any): any {
    let value: any;
    const config: ConfigRecord | undefined = Virt.getConfig(h.stateless, prop);
    if (!config || (config.body === decoratedfield && config.mode !== Mode.Stateless)) { // versioned state
      const r: Record = Snapshot.active().read(h);
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
    const config: ConfigRecord | undefined = Virt.getConfig(h.stateless, prop);
    if (!config || (config.body === decoratedfield && config.mode !== Mode.Stateless)) { // versioned state
      const r: Record = Snapshot.active().tryWrite(h, prop, value);
      if (r !== Record.empty) { // empty when r.data[prop] === value, thus creation of changing record was skipped
        r.data[prop] = value;
        const v: any = r.prev.record.data[prop];
        Record.markChanged(r, prop, !Utils.equal(v, value), value);
      }
    }
    else
      h.stateless[prop] = value;
    return true;
  }

  // getOwnPropertyDescriptor(h: Handle, prop: PropertyKey): PropertyDescriptor | undefined {
  //   const r: Record = Snapshot.active().read(h);
  //   return Reflect.getOwnPropertyDescriptor(r.data, prop);
  // }

  // ownKeys(h: Handle): PropertyKey[] {
  //   const r: Record = Snapshot.active().read(h);
  //   return Reflect.ownKeys(r.data);
  // }

  static decorateClass(implicit: boolean, config: Partial<Config>, origCtor: any): any {
    let ctor: any = origCtor;
    const mode = config.mode;
    if (mode === Mode.Stateful) {
      ctor = function(this: any, ...args: any[]): any {
        const stateless = new origCtor(...args);
        const h: Handle = Virt.createHandle(mode, stateless, undefined);
        return h.proxy;
      };
      Object.setPrototypeOf(ctor, Object.getPrototypeOf(origCtor)); // preserve prototype
      Object.defineProperties(ctor, Object.getOwnPropertyDescriptors(origCtor)); // preserve static definitions
    }
    Virt.applyConfig(ctor.prototype, RT_CLASS, decoratedclass, config, implicit);
    return ctor;
  }

  static decorateField(implicit: boolean, config: Partial<Config>, target: any, prop: PropertyKey): any {
    config = Virt.applyConfig(target, prop, decoratedfield, config, implicit);
    if (config.mode === Mode.Stateful) {
      const get = function(this: any): any {
        const h: Handle = Virt.acquireHandle(this);
        return Virt.proxy.get(h, prop, this);
      };
      const set = function(this: any, value: any): boolean {
        const h: Handle = Virt.acquireHandle(this);
        return Virt.proxy.set(h, prop, value, this);
      };
      const enumerable = true;
      const configurable = false;
      return Object.defineProperty(target, prop, { get, set, enumerable, configurable });
    }
  }

  static decorateMethod(implicit: boolean, config: Partial<Config>, type: any, method: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true;
    const configurable: boolean = true;
    const methodConfig = Virt.applyConfig(type, method, pd.value, config, implicit);
    const get = function(this: any): any {
      const classConfig: ConfigRecord = Virt.getConfig(Object.getPrototypeOf(this), RT_CLASS) || ConfigRecord.default;
      const h: Handle = classConfig.mode !== Mode.Stateless ? Utils.get(this, RT_HANDLE) : Virt.acquireHandle(this);
      const value = Virt.createCachedMethodTrap(h, method, methodConfig);
      Object.defineProperty(h.stateless, method, { value, enumerable, configurable });
      return value;
    };
    return Object.defineProperty(type, method, { get, enumerable, configurable });
  }

  private static applyConfig(target: any, prop: PropertyKey, body: Function | undefined, config: Partial<ConfigRecord>, implicit: boolean): ConfigRecord {
    const table: any = Virt.acquireConfigTable(target);
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
    return target[RT_CONFIG] || /* istanbul ignore next */ EMPTY_CONFIG_TABLE;
  }

  static getConfig(target: any, prop: PropertyKey): ConfigRecord | undefined {
    return Virt.getConfigTable(target)[prop];
  }

  static acquireHandle(obj: any): Handle {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw new Error("only objects can be reactive");
    let h: Handle = Utils.get(obj, RT_HANDLE);
    if (!h) {
      h = new Handle(obj, obj, Virt.proxy);
      Utils.set(obj, RT_HANDLE, h);
      Virt.decorateField(false, {mode: Mode.Stateful}, obj, RT_UNMOUNT);
    }
    return h;
  }

  static createHandle(mode: Mode, stateless: any, proxy: any): Handle {
    const h = new Handle(stateless, proxy, Virt.proxy);
    const r = Snapshot.active().write(h, RT_HANDLE, RT_HANDLE);
    Utils.set(r.data, RT_HANDLE, h);
    initRecordData(h, mode, stateless, r);
    return h;
  }

  /* istanbul ignore next */
  static createCachedMethodTrap = function(h: Handle, prop: PropertyKey, config: ConfigRecord): F<any> {
     throw new Error("createCachedMethodTrap should never be called");
  };
}

function initRecordData(h: Handle, mode: Mode, stateless: any, record: Record): void {
  const configTable = Virt.getConfigTable(Object.getPrototypeOf(stateless));
  const r = Snapshot.active().write(h, RT_HANDLE, RT_HANDLE);
  for (const prop of Object.getOwnPropertyNames(stateless))
    initRecordProp(mode, configTable, prop, r, stateless);
  for (const prop of Object.getOwnPropertySymbols(stateless)) /* istanbul ignore next */
    initRecordProp(mode, configTable, prop, r, stateless);
}

function initRecordProp(mode: Mode, configTable: any, prop: PropertyKey, r: Record, stateless: any): void {
  if (mode !== Mode.Stateless && configTable[prop] !== Mode.Stateless) {
    Utils.copyProp(stateless, r.data, prop);
    Record.markChanged(r, prop, true, RT_HANDLE);
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
