import { Utils, Debug, sleep, rethrow, Record, ICache, F, Handle, Snapshot, Hint, ConfigImpl, Virt, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from "./z.index";
import { Reactronic } from "../Reactronic";
export { Reactronic } from "../Reactronic";
import { Config, Renew, AsyncCalls, Isolation } from "../Config";
import { Transaction } from "../Transaction";
import { Monitor } from "../Monitor";

class CacheProxy extends Reactronic<any> {
  private readonly handle: Handle;
  private readonly blank: Cache;

  get config(): Config { return this.obtain(false, false).cache.config; }
  configure(config: Partial<Config>): Config { return this.alter(config); }

  get cause(): string | undefined { return this.obtain(true, false).cache.cause; }
  get returnValue(): Promise<any> | any { return this.obtain(true, false).cache.returnValue; }
  get result(): any { return this.getResult(); }
  get error(): boolean { return this.obtain(true, false).cache.error; }
  invalidate(cause: string | undefined): boolean { return cause ? Cache.enforceInvalidation(this.obtain(false, false).cache, cause, 0) : false; }
  get isBeingComputed(): boolean { return this.obtain(true, false).cache.computing; }
  get isBeingUpdated(): boolean { return this.obtain(true, false).cache.updater.active !== undefined; }

  constructor(handle: Handle, member: PropertyKey, config: ConfigImpl) {
    super();
    this.handle = handle;
    this.blank = new Cache(Record.blank(), member, config);
    Cache.freeze(this.blank);
    // TODO: mark cache readonly?
  }

  obtain(register: boolean, edit: boolean): { cache: Cache, record: Record } {
    let member = this.blank.member;
    let r: Record = edit ?
      Snapshot.active().writable(this.handle, member, RT_CACHE) :
      Snapshot.active().readable(this.handle);
    let c: Cache = r.data[member] || this.blank;
    if (edit && ((c.cause && (c.record !== r || !c.computing)) || c.config.latency === Renew.DoesNotCache)) {
      let c2 = new Cache(r, c.member, c);
      r.data[c2.member] = c2;
      if (Debug.verbosity >= 5) Debug.log("║", " ", `${c2.hint(false)} is created from ${c === this.blank ? "blank" : c.hint(false)}`);
      Record.markEdited(r, c2.member, true, RT_CACHE);
      c = c2;
    }
    if (register)
      Record.markViewed(r, c.member);
    return { cache: c, record: r };
  }

  alter(config: Partial<Config>): Config {
    let a1 = this.obtain(false, false);
    let c1: Cache = a1.cache;
    let r1: Record = a1.record;
    let hint: string = Debug.verbosity > 2 ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : "configure";
    return Transaction.runAs<Config>(hint, false, 0, (): Config => {
      let a2 = this.obtain(false, true);
      let c2: Cache = a2.cache;
      c2.config = new ConfigImpl(c2.config.body, c2.config, config);
      if (Debug.verbosity >= 4) Debug.log("║", "w", `${Hint.record(r1)}.${c1.member.toString()}.config = ...`);
      return c2.config;
    });
  }

  getResult(): any {
    const c = this.obtain(true, false).cache;
    // if (c.cause !== undefined && !c.updater.active !== undefined)
    //   c.ensureUpToDate(true, ...c.args);
    return c.result;
  }

  invoke(...args: any[]): any {
    let cr = this.obtain(false, false);
    let c: Cache = cr.cache;
    let r: Record = cr.record;
    let reuse = !c.cause && c.config.latency !== Renew.DoesNotCache &&
      c.args[0] === args[0] || c.computing || r.data[RT_UNMOUNT] === RT_UNMOUNT;
    if (!reuse) {
      if (c.updater.active) {
        if (c.config.asyncCalls === AsyncCalls.Reused) {
          if (Debug.verbosity >= 4) Debug.log("║", "f =%", `${Hint.record(r)}.${c.member.toString()}() is reused`);
          Record.markViewed(r, c.member);
          return c.updater.active.returnValue; // Is it really good idea?..
        }
        else if (c.config.asyncCalls >= 1)
          throw new Error(`the number of simultaneous tasks reached the maximum (${c.config.asyncCalls})`);
      }
      let hint: string = (c.config.tracing >= 2 || Debug.verbosity >= 2) ? `${Hint.handle(this.handle)}.${c.member.toString()}` : "recache";
      return Transaction.runAs<any>(hint, c.config.isolation >= Isolation.StandaloneTransaction, c.config.tracing, (...argsx: any[]): any => {
        if (c.updater.active && c.config.asyncCalls === AsyncCalls.Relayed) {
          c.updater.active.tran.cancel();
          if (Debug.verbosity >= 3) Debug.log("║", " ", `Relaying: t${c.updater.active.tran.id} is canceled.`);
          c.updater.active = undefined;
        }
        let c1: Cache = c;
        let cr2 = this.obtain(false, true);
        let c2: Cache = cr2.cache;
        let r2: Record = cr2.record;
        let ind: Monitor | null = c1.config.monitor;
        c2.enter(r2, c1, ind);
        try
        {
          if (argsx.length > 0)
            c2.args = argsx;
          else
            argsx = c2.args;
          c2.returnValue = Cache.run<any>(c2, (...argsy: any[]): any => {
            return c2.config.body.call(this.handle.proxy, ...argsy);
          }, ...argsx);
          c2.cause = undefined;
        }
        finally {
          c2.leave(r2, c1, ind);
        }
        Record.markViewed(r2, c2.member);
        return c2.returnValue;
      }, ...args);
    }
    else {
      if (Debug.verbosity >= 4) Debug.log("║", "f ==", `${Hint.record(r)}.${c.member.toString()}() hits cache`);
      Record.markViewed(r, c.member);
      return c.returnValue;
    }
  }
}

// Cache

export class Cache implements ICache {
  static active?: Cache = undefined;
  readonly margin: number;
  readonly tran: Transaction;
  readonly record: Record;
  readonly member: PropertyKey;
  config: ConfigImpl;
  args: any[];
  returnValue: any;
  result: any;
  computing: boolean;
  error: any;
  cause?: string;
  readonly updater: { active: Cache | undefined }; // TODO: count updaters
  readonly observables: Map<PropertyKey, Set<Record>>;
  readonly hotObservables: Map<PropertyKey, Set<Record>>;

  constructor(record: Record, member: PropertyKey, init: Cache | ConfigImpl) {
    this.margin = Cache.active ? Cache.active.margin + 1 : 0;
    this.tran = Transaction.active;
    this.record = record;
    this.member = member;
    if (init instanceof Cache) {
      this.config = init.config;
      this.args = init.args;
    }
    else {
      this.config = init;
      this.args = [];
    }
    // this.returned = undefined;
    this.computing = false;
    // this.value = undefined;
    // this.error = undefined;
    this.cause = "Cache.ctor"; // this.hint(false);
    this.updater = { active: undefined };
    this.observables = new Map<PropertyKey, Set<Record>>();
    this.hotObservables = new Map<PropertyKey, Set<Record>>();
  }

  hint(tranless?: boolean): string { return `${Hint.record(this.record, tranless, false, this.member)}`; }

  static at(method: F<any>): Reactronic<any> {
    let impl: Reactronic<any> | undefined = Utils.get(method, RT_CACHE);
    if (!impl)
      throw new Error("given method is not a reaction");
    return impl;
  }

  static run<T>(c: Cache | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined;
    let outer = Cache.active;
    let outerVerbosity = Debug.verbosity;
    try {
      Cache.active = c;
      if (c && c.config.tracing !== 0)
          Debug.verbosity = c.config.tracing;
      result = func(...args);
    }
    catch (e) {
      if (c)
        c.error = e;
      throw e;
    }
    finally {
      Debug.verbosity = outerVerbosity;
      Cache.active = outer;
    }
    return result;
  }

  wrap<T>(func: F<T>): F<T> {
    let caching: F<T> = (...args: any[]): T => Cache.run<T>(this, func, ...args);
    return caching;
  }

  ensureUpToDate(now: boolean, ...args: any[]): void {
    if (now || this.config.latency === Renew.Immediately) {
      if ((this.config.latency === Renew.DoesNotCache || this.cause) && !this.error) {
        let proxy: any = Utils.get(this.record.data, RT_HANDLE).proxy;
        let result: any = Reflect.get(proxy, this.member, proxy)(...args);
        if (result instanceof Promise)
          result.catch((error: any) => { /* nop */ }); // bad idea to hide an error
      }
    }
    else
      sleep(this.config.latency).then(() => this.ensureUpToDate(true, ...args));
  }

  static markViewed(r: Record, prop: PropertyKey): void {
    const c: Cache | undefined = Cache.active; // alias
    if (c && c.config.latency >= Renew.Manually && prop !== RT_HANDLE) {
      Cache.acquireObservableSet(c, prop, c.tran.id === r.snapshot.id).add(r);
      if (Debug.verbosity >= 5) Debug.log("║", "r", `${c.hint(true)} uses ${Hint.record(r)}.${prop.toString()}`);
    }
  }

  static markEdited(r: Record, prop: PropertyKey, edited: boolean, value: any): void {
    edited ? r.edits.add(prop) : r.edits.delete(prop);
    if (Debug.verbosity >= 4) Debug.log("║", "w", `${Hint.record(r, true)}.${prop.toString()} = ${Utils.valueHint(value)}`);
    let observers: Set<ICache> | undefined = r.observers.get(prop);
    if (observers && observers.size > 0) {
      let effect: ICache[] = [];
      observers.forEach((c: ICache) => c.invalidateBy(
        Hint.record(r, false, false, prop), true, false, effect));
      r.observers.delete(prop);
      if (effect.length > 0)
        Transaction.ensureAllUpToDate(Hint.record(r),
          { tran: Transaction.active, effect });
    }
  }

  static applyDependencies(changeset: Map<Handle, Record>, effect: ICache[]): void {
    changeset.forEach((r: Record, h: Handle) => {
      let unmount: boolean = r.edits.has(RT_UNMOUNT);
      // Either mark previous record observers as invalidated, or retain them
      if (r.prev.record) {
        let prev: Record = r.prev.record;
        if (unmount) {
          for (let prop in prev.data)
            Cache.markOverwritten(prev, prop, effect);
          prev.observers.forEach((prevObservers: Set<ICache>, prop: PropertyKey) =>
            prevObservers.forEach((c: ICache) => c.invalidateBy(Hint.record(r, false, false, prop), false, false, effect)));
        }
        else
          prev.observers.forEach((prevObservers: Set<ICache>, prop: PropertyKey) => {
            if (r.edits.has(prop))
              prevObservers.forEach((c: ICache) => c.invalidateBy(Hint.record(r, false, false, prop), false, false, effect));
            else
              Cache.retainPrevObservers(r, prop, prev, prevObservers);
          });
      }
      // Mark previous properties as overwritten and check if reactions are not yet invalidated
      if (!unmount)
        r.edits.forEach((prop: PropertyKey) => {
          Cache.markOverwritten(r.prev.record, prop, effect);
          let c: Cache = r.data[prop];
          if (c instanceof Cache) {
            let cause = c.subscribeToObservables(false);
            if (cause)
              c.invalidateBy(cause, false, false, effect);
          }
        });
    });
  }

  static acquireObserverSet(r: Record, prop: PropertyKey): Set<ICache> {
    let result: Set<ICache> | undefined = r.observers.get(prop);
    if (!result) {
      r.observers.set(prop, result = new Set<Cache>());
      if (Debug.verbosity >= 5) Debug.log("", "   Observers:", `${Hint.record(r, false, false, prop)} = new`);
      let x: Record | undefined = r.prev.record;
      while (x && !x.observers.get(prop) && x.data[prop] === r.data[prop]) { // "===" - workaround?
        x.observers.set(prop, result);
        if (Debug.verbosity >= 5) Debug.log("", "   Observers:", `${Hint.record(x, false, false, prop)} = ${Hint.record(r, false, false, prop)}`);
        x = x.prev.record;
      }
    }
    return result;
  }

  static acquireObservableSet(c: Cache, prop: PropertyKey, hot: boolean): Set<Record> {
    let o = hot ? c.hotObservables : c.observables;
    let result: Set<Record> | undefined = o.get(prop);
    if (!result)
      o.set(prop, result = new Set<Record>());
    return result;
  }

  private subscribeToObservables(hot: boolean): string | undefined {
    let cause: string | undefined = undefined;
    let subscriptions: string[] = [];
    let o = hot ? this.hotObservables : this.observables;
    o.forEach((observables: Set<Record>, prop: PropertyKey) => {
      observables.forEach((r: Record) => {
        Cache.acquireObserverSet(r, prop).add(this); // link
        if (Debug.verbosity >= 3) subscriptions.push(Hint.record(r, false, true, prop));
        if (!cause && r.overwritten.has(prop))
          cause = Hint.record(r, false, false, prop); // need to invalidate
      });
    });
    if (Debug.verbosity >= 3 && subscriptions.length > 0) Debug.log(hot ? "║" : " ", "∞", `${Hint.record(this.record, false, false, this.member)} is subscribed to {${subscriptions.join(", ")}}.`);
    return cause;
  }

  static retainPrevObservers(r: Record, prop: PropertyKey, prev: Record, prevObservers: Set<ICache>): Set<ICache> {
    let thisObservers: Set<ICache> | undefined = r.observers.get(prop);
    if (thisObservers) {
      thisObservers.forEach((c: ICache) => prevObservers.add(c));
      if (Debug.verbosity >= 5) Debug.log("", "   Observers:", `${Hint.record(prev, false, false, prop)}(${prevObservers.size}) += ${Hint.record(r, false, false, prop)}(${thisObservers.size})`);
    }
    r.observers.set(prop, prevObservers);
    if (Debug.verbosity >= 5) Debug.log("", "   Observers:", `${Hint.record(r, false, false, prop)} = ${Hint.record(prev, false, false, prop)}(${prevObservers.size})`);
    return prevObservers;
  }

  invalidateBy(cause: string, hot: boolean, cascade: boolean, effect: ICache[]): void {
    if (!this.cause && (!cascade || this.config.latency !== Renew.WhenReady)) {
      this.cause = cause;
      // if (this.updater.active) {
      //   this.updater.active.tran.cancel();
      //   if (Debug.verbosity >= 2) Debug.log("║", " ", `Invalidation: t${this.updater.active.tran.id} is canceled.`);
      //   this.updater.active = undefined;
      // }
      // TODO: make cache readonly
      // Cascade invalidation
      let r: Record = Snapshot.active().readable(Utils.get(this.record.data, RT_HANDLE));
      if (r.data[this.member] === this) { // TODO: Consider better solution?
        let rr: Record | undefined = r;
        while (rr && !rr.overwritten.has(this.member)) {
          let o: Set<ICache> | undefined = rr.observers.get(this.member);
          if (o)
            o.forEach((c: ICache) => c.invalidateBy(Hint.record(r, false, false, this.member), false, true, effect));
          rr = rr.prev.record;
        }
      }
      // Check if cache should be renewed
      if (this.config.latency >= Renew.Immediately && r.data[RT_UNMOUNT] !== RT_UNMOUNT) {
        effect.push(this);
        if (Debug.verbosity >= 2) Debug.log(" ", "■", `${this.hint(false)} is invalidated by ${cause} and will run automatically`);
      }
      else
      if (Debug.verbosity >= 2) Debug.log(" ", "□", `${this.hint(false)} is invalidated by ${cause}`);
    }
  }

  static enforceInvalidation(c: Cache, cause: string, latency: number): boolean {
    let effect: Cache[] = [];
    c.invalidateBy(cause, false, false, effect);
    if (latency === Renew.Immediately)
      Transaction.ensureAllUpToDate(cause, { effect });
    else
      sleep(latency).then(() => Transaction.ensureAllUpToDate(cause, { effect }));
    return true;
  }

  static markOverwritten(self: Record | undefined, prop: PropertyKey, effect: ICache[]): void {
    while (self && !self.overwritten.has(prop)) {
      let r = self;
      r.overwritten.add(prop);
      let o: Set<ICache> | undefined = r.observers.get(prop);
      if (o)
        o.forEach((c: ICache) => c.invalidateBy(Hint.record(r, false, false, prop), false, false, effect));
      // Utils.freezeSet(o);
      self = self.prev.record;
    }
  }

  static createCacheTrap(h: Handle, prop: PropertyKey, config: ConfigImpl): F<any> {
    let impl = new CacheProxy(h, prop, config);
    let cachedInvoke: F<any> = (...args: any[]): any => impl.invoke(...args);
    Utils.set(cachedInvoke, RT_CACHE, impl);
    return cachedInvoke;
  }

  enter(r: Record, prev: Cache, mon: Monitor | null): void {
    if (this.config.tracing >= 4 || (this.config.tracing === 0 && Debug.verbosity >= 4)) Debug.log("║", "f =>", `${Hint.record(r, true)}.${this.member.toString()} is started`);
    this.computing = true;
    this.monitorEnter(mon);
    if (!prev.updater.active)
      prev.updater.active = this;
  }

  leave(r: Record, prev: Cache, ind: Monitor | null): void {
    if (this.returnValue instanceof Promise) {
      this.returnValue = this.returnValue.then(
        result => {
          this.result = result;
          this.leaveImpl(r, prev, ind, "<=", "is completed");
          return result;
        },
        error => {
          this.error = error;
          this.leaveImpl(r, prev, ind, "<=", "is completed with error");
          throw error;
        });
      if (this.config.tracing >= 2 || (this.config.tracing === 0 && Debug.verbosity >= 2)) Debug.log("║", "f ..", `${Hint.record(r, true)}.${this.member.toString()} is async`);
    }
    else {
      this.result = this.returnValue;
      this.leaveImpl(r, prev, ind, "<=", "is completed");
    }
  }

  private leaveImpl(r: Record, prev: Cache, mon: Monitor | null, op: string, message: string): void {
    if (prev.updater.active === this)
      prev.updater.active = undefined;
    this.monitorLeave(mon);
    this.computing = false;
    if (this.config.tracing >= 2 || (this.config.tracing === 0 && Debug.verbosity >= 2)) Debug.log("║", `f ${op}`, `${Hint.record(r, true)}.${this.member.toString()} ${message}`);
    // TODO: handle errors
    this.subscribeToObservables(true);
    this.hotObservables.clear();
  }

  monitorEnter(mon: Monitor | null): void {
    if (mon)
      Transaction.runAs<void>("Monitor.enter", mon.isolation >= Isolation.StandaloneTransaction, 0,
        Cache.run, undefined, () => mon.enter(this));
  }

  monitorLeave(mon: Monitor | null): void {
    if (mon) {
      if (mon.prolonged) {
        let outer = Transaction.active;
        try {
          Transaction.active = Transaction.notran; // Workaround?
          let leave = () => {
            Transaction.runAs<void>("Monitor.leave", mon.isolation >= Isolation.StandaloneTransaction, 0,
              Cache.run, undefined, () => mon.leave(this));
          };
          this.tran.whenFinished(false).then(leave, leave);
        }
        finally {
          Transaction.active = outer;
        }
      }
      else
        Transaction.runAs<void>("Monitor.leave", mon.isolation >= Isolation.StandaloneTransaction, 0,
          Cache.run, undefined, () => mon.leave(this));
    }
  }

  static differentImpl(oldValue: any, newValue: any): boolean {
    let result: boolean;
    if (oldValue instanceof Cache) {
      if (newValue instanceof Cache)
        result = !(oldValue.config.latency === Renew.DoesNotCache || oldValue.returnValue === newValue.returnValue);
      else if (newValue instanceof Function) /* istanbul ignore next */
        result = oldValue.config.body !== newValue;
      else
        result = true;
    }
    else
      result = !Utils.equal(oldValue, newValue);
    return result;
  }

  static freeze(c: Cache): void {
    Utils.freezeMap(c.observables);
    // Utils.freezeSet(c.statusObservables);
    Object.freeze(c);
  }

  static unmount(...objects: any[]): Transaction {
    let t: Transaction = Transaction.active;
    Transaction.runAs<void>("unmount", false, 0, (): void => {
      t = Transaction.active;
      for (let x of objects) {
        if (Utils.get(x, RT_HANDLE))
          x[RT_UNMOUNT] = RT_UNMOUNT;
      }
    });
    return t;
  }
}

// Global Init

const original_primise_then = Promise.prototype.then;
Promise.prototype.then = function(
  this: any, onsuccess?: ((value: any) => any | PromiseLike<any>) | undefined | null,
  onfailure?: ((reason: any) => never | PromiseLike<never>) | undefined | null): Promise<any | never>
{
  let t = Transaction.active;
  if (!t.finished()) {
    if (onsuccess) {
      onsuccess = Transaction._wrap<any>(t, Cache.active, true, true, onsuccess);
      onfailure = Transaction._wrap<any>(t, Cache.active, false, true, onfailure || rethrow);
    }
    else if (onfailure)
      onfailure = Transaction._wrap<any>(t, Cache.active, false, false, onfailure);
  }
  return original_primise_then.call(this, onsuccess, onfailure);
};

function init(): void {
  Utils.different = Cache.differentImpl; // override
  Record.markViewed = Cache.markViewed; // override
  Record.markEdited = Cache.markEdited; // override
  Snapshot.applyDependencies = Cache.applyDependencies; // override
  Virt.createCacheTrap = Cache.createCacheTrap; // override
  Record.blank = Transaction._getBlankRecord; // override
  Snapshot.active = Transaction._getActiveSnapshot; // override
  Transaction._init();
}

init();
