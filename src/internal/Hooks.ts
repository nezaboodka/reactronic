import { Utils, undef } from "./Utils";
import { ArrayEx, Binding } from "./ArrayEx";
import { Record, F } from "./Record";
import { Handle, RT_HANDLE } from "./Handle";
import { Snapshot } from "./Snapshot";
import { Config, Mode, Latency, Renew, AsyncCalls, Isolation } from "../Config";
import { Indicator } from "../Indicator";

// Config

export const RT_CONFIG: unique symbol = Symbol("RT:CONFIG");
export const RT_CLASS: unique symbol = Symbol("RT:CLASS");

export class ConfigImpl implements Config {
  readonly body: Function;
  readonly mode: Mode;
  readonly latency: Latency;
  readonly isolation: Isolation;
  readonly asyncCalls: AsyncCalls;
  readonly indicator: Indicator | null;

  constructor(body: Function | undefined, existing: ConfigImpl, patch: Partial<ConfigImpl>) {
    this.body = body !== undefined ? body : existing.body;
    this.mode = patch.mode !== undefined ? patch.mode : existing.mode;
    this.latency = patch.latency !== undefined ? patch.latency : existing.latency;
    this.isolation = patch.isolation !== undefined ? patch.isolation : existing.isolation;
    this.asyncCalls = patch.asyncCalls !== undefined ? patch.asyncCalls : existing.asyncCalls;
    this.indicator = patch.indicator !== undefined ? patch.indicator : existing.indicator;
    Object.freeze(this);
  }

  static default = new ConfigImpl(undef, {
    body: undef,
    mode: Mode.Stateless,
    latency: Renew.DoNotCache,
    isolation: Isolation.Default,
    asyncCalls: AsyncCalls.Single,
    indicator: null }, {});
}

// Hooks

export class Hooks implements ProxyHandler<Handle> {
  static readonly global: Hooks = new Hooks();

  getPrototypeOf(h: Handle): object | null {
    return h.proto;
  }

  get(h: Handle, prop: PropertyKey, receiver: any): any {
    let value: any;
    let config: ConfigImpl | undefined = Hooks.getConfig(h.proto, prop);
    if (!config || (config.body === decoratedfield && config.mode !== Mode.Stateless)) { // versioned state
      let r: Record = Snapshot.active().readable(h);
      value = r.data[prop];
      if (value === undefined && !r.data.hasOwnProperty(prop))
        value = Reflect.get(h.proto, prop, receiver);
      Record.markViewed(r, prop);
    }
    else {
      value = h.stateless[prop];
      if (config.mode !== Mode.Stateless && value === undefined)
        value = h.stateless[prop] = Hooks.createCacheTrap(h, prop, config);
    }
    return value;
  }

  set(h: Handle, prop: PropertyKey, value: any, receiver: any): boolean {
    let config: ConfigImpl | undefined = Hooks.getConfig(h.proto, prop);
    if (!config || (config.body === decoratedfield && config.mode !== Mode.Stateless)) { // versioned state
      let r: Record | undefined = Snapshot.active().tryGetWritable(h, prop, value);
      if (r) // undefined when r.data[prop] === value, thus creation of edit record was skipped
        r.data[prop] = value;
    }
    else {
      if (config.mode !== Mode.Stateless)
        throw new Error("not yet supported");
      h.stateless[prop] = value;
    }
    return true;
  }

  static decorateClass(config: Partial<Config>, origCtor: any): any {
    let ctor: any = origCtor;
    if (config.mode !== Mode.Stateless) {
      ctor = function(this: any, ...args: any[]): any {
        let h: Handle = createHandle(this, undefined);
        origCtor.call(h.proxy, ...args);
        return h.proxy;
      };
      ctor.prototype = origCtor.prototype;
      Object.assign(ctor, origCtor); // preserve static definitions
    }
    Hooks.applyConfig(ctor.prototype, RT_CLASS, decoratedclass, config);
    return ctor;
  }

  static decorateField(config: Partial<Config>, target: any, prop: PropertyKey): any {
    config = Hooks.applyConfig(target, prop, decoratedfield, config);
    if (config.mode !== Mode.Stateless) {
      let get = function(this: any): any {
        let h: Handle = acquireHandle(this);
        return Hooks.global.get(h, prop, this);
      };
      let set = function(this: any, value: any): boolean {
        let h: Handle = acquireHandle(this);
        return Hooks.global.set(h, prop, value, this);
      };
      let enumerable = true;
      let configurable = false;
      return Object.defineProperty(target, prop, { get, set, enumerable, configurable });
    }
  }

  static decorateMethod(config: Partial<Config>, type: any, method: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
    config = Hooks.applyConfig(type, method, pd.value, config);
    let get = function(this: any): any {
      let g: ConfigImpl | undefined = Hooks.getConfig(Object.getPrototypeOf(this), RT_CLASS) || ConfigImpl.default;
      let h: Handle = g.mode !== Mode.Stateless ? Utils.get(this, RT_HANDLE) : acquireHandle(this);
      return Hooks.global.get(h, method, this);
    };
    let enumerable: boolean = pd ? pd.enumerable === true : true;
    let configurable: boolean = true;
    return Object.defineProperty(type, method, { get, enumerable, configurable });
  }

  private static applyConfig(target: any, prop: PropertyKey, body: Function | undefined, config: Partial<ConfigImpl>): ConfigImpl {
    let table: any = Hooks.acquireConfigTable(target);
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

  static getConfig(target: any, prop: PropertyKey): ConfigImpl | undefined {
    let table = target[RT_CONFIG] || EMPTY_CONFIG_TABLE;
    return table[prop];
  }

  static createCacheTrap = function(h: Handle, m: PropertyKey, o: ConfigImpl): F<any> {
    throw new Error("not implemented");
  };
}

function decoratedfield(...args: any[]): never {
  /* istanbul ignore next */ throw new Error("this method should never be called");
}

function decoratedclass(...args: any[]): never {
  /* istanbul ignore next */ throw new Error("this method should never be called");
}

const EMPTY_CONFIG_TABLE = {};

export class ArrayHooks implements ProxyHandler<Binding> {
  static readonly global: ArrayHooks = new ArrayHooks();

  get(binding: Binding, prop: PropertyKey, receiver: any): any {
    let a: any = binding.readable(receiver);
    return a[prop];
  }

  set(binding: Binding, prop: PropertyKey, value: any, receiver: any): boolean {
    let a: any = binding.writable(receiver);
    return a[prop] = value;
  }

  static freezeAndWrapArray(owner: any, prop: PropertyKey, array: any[]): any {
    return new Proxy(ArrayEx.bind(owner, prop, array), ArrayHooks.global);
  }
}

function acquireHandle(obj: any): Handle {
  if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
    throw new Error("E604: only objects can be registered in reactronic store");
  let h: Handle = Utils.get(obj, RT_HANDLE);
  if (!h) {
    Snapshot.active().checkout(); // TODO: find better place?
    h = createHandle(obj, obj);
    Utils.set(obj, RT_HANDLE, h);
  }
  return h;
}

function createHandle(obj: any, proxy: any): Handle {
  let r = new Record(undefined, Snapshot.zero, {});
  let h = new Handle(proxy, Hooks.global, r, obj);
  Utils.set(r.data, RT_HANDLE, h);
  r.finalize(h.proxy);
  return h;
}
