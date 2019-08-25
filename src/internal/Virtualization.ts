import { Utils, undef } from "./Utils";
import { CopyOnWriteArray, Binding } from "./Binding.CopyOnWriteArray";
import { CopyOnWriteSet } from "./Binding.CopyOnWriteSet";
import { CopyOnWriteMap } from "./Binding.CopyOnWriteMap";
import { Record, F, RT_UNMOUNT } from "./Record";
import { Handle, RT_HANDLE } from "./Handle";
import { Snapshot } from "./Snapshot";
import { Config, Mode, Latency, Renew, Reenter, Apart } from "../Config";
import { Monitor } from "../Monitor";

// Config

export const RT_CONFIG: unique symbol = Symbol("RT:CONFIG");
export const RT_CLASS: unique symbol = Symbol("RT:CLASS");
const EMPTY_CONFIG_TABLE = {};

export class ConfigImpl implements Config {
  readonly body: Function;
  readonly mode: Mode;
  readonly latency: Latency;
  readonly apart: Apart;
  readonly reenter: Reenter;
  readonly monitor: Monitor | null;
  readonly tracing: number;

  constructor(body: Function | undefined, existing: ConfigImpl, patch: Partial<ConfigImpl>) {
    this.body = body !== undefined ? body : existing.body;
    this.mode = patch.mode !== undefined ? patch.mode : existing.mode;
    this.latency = patch.latency !== undefined ? patch.latency : existing.latency;
    this.apart = patch.apart !== undefined ? patch.apart : existing.apart;
    this.reenter = patch.reenter !== undefined ? patch.reenter : existing.reenter;
    this.monitor = patch.monitor !== undefined ? patch.monitor : existing.monitor;
    this.tracing = patch.tracing !== undefined ? patch.tracing : existing.tracing;
    Object.freeze(this);
  }

  static default = new ConfigImpl(undef, {
    body: undef,
    mode: Mode.Stateless,
    latency: Renew.NoCache,
    apart: Apart.Default,
    reenter: Reenter.Prevented,
    monitor: null,
    tracing: 0 }, {});
}

// Virtualization

export class Virt implements ProxyHandler<Handle> {
  static readonly proxy: Virt = new Virt();

  getPrototypeOf(h: Handle): object | null {
    return Reflect.getPrototypeOf(h.stateless);
  }

  get(h: Handle, prop: PropertyKey, receiver: any): any {
    let value: any;
    let config: ConfigImpl | undefined = Virt.getConfig(h.stateless, prop);
    if (!config || (config.body === decoratedfield && config.mode !== Mode.Stateless)) { // versioned state
      let r: Record = Snapshot.active().read(h);
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
    let config: ConfigImpl | undefined = Virt.getConfig(h.stateless, prop);
    if (!config || (config.body === decoratedfield && config.mode !== Mode.Stateless)) { // versioned state
      let r: Record = Snapshot.active().tryEdit(h, prop, value);
      if (r !== Record.empty) { // empty when r.data[prop] === value, thus creation of edit record was skipped
        r.data[prop] = value;
        let v: any = r.prev.record.data[prop];
        Record.markEdited(r, prop, !Utils.equal(v, value), value);
      }
    }
    else {
      if (config.mode !== Mode.Stateless)
        throw new Error("[E600] not yet supported - config.mode !== Mode.Stateless");
      Reflect.set(h.stateless, prop, value, receiver);
    }
    return true;
  }

  ownKeys(h: Handle): PropertyKey[] {
    // TODO: Exclude caches from the list of own keys
    let r: Record = Snapshot.active().read(h);
    return Reflect.ownKeys(r.data);
  }

  static decorateClass(config: Partial<Config>, origCtor: any): any {
    let ctor: any = origCtor;
    let mode = config.mode || Mode.Stateful;
    if (mode !== Mode.Stateless) {
      ctor = function(this: any, ...args: any[]): any {
        let stateless = new origCtor(...args);
        let h: Handle = Virt.createHandle(mode, stateless, undefined);
        return h.proxy;
      };
      ctor.prototype = origCtor.prototype;
      Object.assign(ctor, origCtor); // preserve static definitions
    }
    Virt.applyConfig(ctor.prototype, RT_CLASS, decoratedclass, config);
    return ctor;
  }

  static decorateField(config: Partial<Config>, target: any, prop: PropertyKey): any {
    config = Virt.applyConfig(target, prop, decoratedfield, config);
    if (config.mode !== Mode.Stateless) {
      let get = function(this: any): any {
        let h: Handle = Virt.acquireHandle(this);
        return Virt.proxy.get(h, prop, this);
      };
      let set = function(this: any, value: any): boolean {
        let h: Handle = Virt.acquireHandle(this);
        return Virt.proxy.set(h, prop, value, this);
      };
      let enumerable = true;
      let configurable = false;
      return Object.defineProperty(target, prop, { get, set, enumerable, configurable });
    }
  }

  static decorateMethod(config: Partial<Config>, type: any, method: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
    let enumerable: boolean = pd ? pd.enumerable === true : true;
    let configurable: boolean = true;
    let methodConfig = Virt.applyConfig(type, method, pd.value, config);
    let get = function(this: any): any {
      let classConfig: ConfigImpl = Virt.getConfig(Object.getPrototypeOf(this), RT_CLASS) || ConfigImpl.default;
      let h: Handle = classConfig.mode !== Mode.Stateless ? Utils.get(this, RT_HANDLE) : Virt.acquireHandle(this);
      let value = Virt.createCachedInvoke(h, method, methodConfig);
      Object.defineProperty(h.stateless, method, { value, enumerable, configurable });
      return value;
    };
    return Object.defineProperty(type, method, { get, enumerable, configurable });
  }

  private static applyConfig(target: any, prop: PropertyKey, body: Function | undefined, config: Partial<ConfigImpl>): ConfigImpl {
    let table: any = Virt.acquireConfigTable(target);
    let existing: ConfigImpl = table[prop] || ConfigImpl.default;
    let result = table[prop] = new ConfigImpl(body, existing, config);
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
    return target[RT_CONFIG] || EMPTY_CONFIG_TABLE;
  }

  static getConfig(target: any, prop: PropertyKey): ConfigImpl | undefined {
    return Virt.getConfigTable(target)[prop];
  }

  static acquireHandle(obj: any): Handle {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw new Error("[E605] only objects can be registered in reactronic store");
    let h: Handle = Utils.get(obj, RT_HANDLE);
    if (!h) {
      h = new Handle(obj, obj, Virt.proxy);
      Utils.set(obj, RT_HANDLE, h);
      Virt.decorateField({mode: Mode.Stateful}, obj, RT_UNMOUNT);
    }
    return h;
  }

  static createHandle(mode: Mode, stateless: any, proxy: any): Handle {
    let h = new Handle(stateless, proxy, Virt.proxy);
    let r = Snapshot.active().edit(h, RT_HANDLE, RT_HANDLE);
    Utils.set(r.data, RT_HANDLE, h);
    Virt.initRecordData(h, mode, stateless, r);
    return h;
  }

  static initRecordData(h: Handle, mode: Mode, stateless: any, record: Record): void {
    let configTable = Virt.getConfigTable(Object.getPrototypeOf(stateless));
    let r = Snapshot.active().edit(h, RT_HANDLE, RT_HANDLE);
    for (let prop of Object.getOwnPropertyNames(stateless)) {
      if (mode !== Mode.Stateless && configTable[prop] !== Mode.Stateless) {
        Utils.copyProp(stateless, r.data, prop);
        Record.markEdited(r, prop, true, RT_HANDLE);
      }
    }
    for (let prop of Object.getOwnPropertySymbols(stateless)) {
      if (mode !== Mode.Stateless && configTable[prop] !== Mode.Stateless) {
        Utils.copyProp(stateless, r.data, prop);
        Record.markEdited(r, prop, true, RT_HANDLE);
      }
    }
  }

  static createCachedInvoke = function(h: Handle, prop: PropertyKey, config: ConfigImpl): F<any> {
    /* istanbul ignore next */ throw new Error("this method should never be called");
  };
}

function decoratedfield(...args: any[]): never {
  /* istanbul ignore next */ throw new Error("this method should never be called");
}

function decoratedclass(...args: any[]): never {
  /* istanbul ignore next */ throw new Error("this method should never be called");
}

export class CopyOnWrite implements ProxyHandler<Binding<any>> {
  static readonly global: CopyOnWrite = new CopyOnWrite();

  get(binding: Binding<any>, prop: PropertyKey, receiver: any): any {
    let a: any = binding.readable(receiver);
    return a[prop];
  }

  set(binding: Binding<any>, prop: PropertyKey, value: any, receiver: any): boolean {
    let a: any = binding.writable(receiver);
    return a[prop] = value;
  }

  static seal(data: any, proxy: any, prop: PropertyKey): void {
    let value = data[prop];
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
