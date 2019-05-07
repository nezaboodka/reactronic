import { Utils, Debug, sleep, rethrow, Record, ICache, F, Handle, Snapshot, Hint, ConfigImpl, Virt, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from "./z.index";
import { ReactiveCache } from "../ReactiveCache";
export { ReactiveCache } from "../ReactiveCache";
import { Config, Renew, AsyncCalls, Isolation } from "../Config";
import { Transaction } from "../Transaction";
import { Monitor } from "../Monitor";

interface CacheCall {
  record: Record;
  cache: Cache;
  isUpToDate: boolean;
}

class ReactiveCacheImpl extends ReactiveCache<any> {
  private readonly handle: Handle;
  private readonly blank: Cache;

  get config(): Config { return this.read(false).cache.config; }
  configure(config: Partial<Config>): Config { return this.reconfigure(config); }
  get returnValue(): Promise<any> | any { return this.read(true).cache.returnValue; }
  get error(): boolean { return this.read(true).cache.error; }
  outdate(cause: string | undefined): boolean { return cause ? Cache.enforceOutdated(this.read(false).cache, cause, 0) : false; }
  get isOutdated(): boolean { return !this.read(true).isUpToDate; }
  get isComputing(): boolean { return this.read(true).cache.started > 0; }
  get isUpdating(): boolean { return this.read(true).cache.outdated.recomputation !== undefined; }

  constructor(handle: Handle, member: PropertyKey, config: ConfigImpl) {
    super();
    this.handle = handle;
    this.blank = new Cache(Record.empty, member, config);
    Cache.freeze(this.blank);
    // TODO: mark cache readonly?
  }

  result(...args: any): any {
    let cc = this.obtain(...args);
    if (cc.isUpToDate)
      Record.markViewed(cc.record, cc.cache.member);
    else if (cc.record.prev.record !== Record.empty)
      Record.markViewed(cc.record.prev.record, cc.cache.member);
    return cc.cache.result;
  }

  invoke(...args: any[]): any {
    let cc = this.obtain(...args);
    Record.markViewed(cc.record, cc.cache.member);
    return cc.cache.returnValue;
  }

  private obtain(...args: any[]): CacheCall {
    let cc = this.read(false);
    let c: Cache = cc.cache;
    let hit = (cc.isUpToDate || c.started > 0) && c.config.latency !== Renew.DoesNotCache &&
      c.args[0] === args[0] || cc.record.data[RT_UNMOUNT] === RT_UNMOUNT;
    if (!hit) {
      if (c.outdated.recomputation) {
        if (c.config.asyncCalls === AsyncCalls.Reused)
          throw new Error("not implemented");
        else if (c.config.asyncCalls >= 1)
          throw new Error(`the number of simultaneous tasks reached the maximum (${c.config.asyncCalls})`);
      }
      let hint: string = (c.config.tracing >= 2 || Debug.verbosity >= 2) ? `${Hint.handle(this.handle)}.${c.member.toString()}` : "recache";
      Transaction.runAs<any>(hint, c.config.isolation >= Isolation.StandaloneTransaction, c.config.tracing, (...argsx: any[]): any => {
        cc = this.recache(cc, ...argsx);
        return cc.cache.returnValue;
      }, ...args);
    }
    else
      if (Debug.verbosity >= 4) Debug.log("║", "f ==", `${Hint.record(cc.record)}.${c.member.toString()}() hits cache`);
    return cc;
  }

  private read(markViewed: boolean): CacheCall {
    let ctx = Snapshot.active();
    let member = this.blank.member;
    let r: Record = ctx.tryRead(this.handle);
    let c: Cache = r.data[member] || this.blank;
    let valid = ctx.timestamp < c.outdated.timestamp;
    if (markViewed)
      Record.markViewed(r, c.member);
    return { cache: c, record: r, isUpToDate: valid };
  }

  private edit(): CacheCall {
    let ctx = Snapshot.active();
    let member = this.blank.member;
    let r: Record = ctx.edit(this.handle, member, RT_CACHE);
    let c: Cache = r.data[member] || this.blank;
    let isUpToDate = ctx.timestamp < c.outdated.timestamp;
    if ((!isUpToDate && (c.record !== r || c.started === 0)) || c.config.latency === Renew.DoesNotCache) {
      let c2 = new Cache(r, c.member, c);
      r.data[c2.member] = c2;
      if (Debug.verbosity >= 5) Debug.log("║", " ", `${c2.hint(false)} is being recached over ${c === this.blank ? "blank" : c.hint(false)}`);
      Record.markEdited(r, c2.member, true, RT_CACHE);
      c = c2;
    }
    return { cache: c, record: r, isUpToDate };
  }

  private recache(cc: CacheCall, ...argsx: any[]): CacheCall {
    let c = cc.cache;
    if (c.outdated.recomputation && c.config.asyncCalls === AsyncCalls.Relayed) {
      c.outdated.recomputation.tran.cancel();
      if (Debug.verbosity >= 3) Debug.log("║", " ", `Relaying: t${c.outdated.recomputation.tran.id} is canceled.`);
      c.outdated.recomputation = undefined;
    }
    let cc2 = this.edit();
    let c2: Cache = cc2.cache;
    let r2: Record = cc2.record;
    let mon: Monitor | null = c.config.monitor;
    c2.enter(r2, c, mon);
    try
    {
      if (argsx.length > 0)
        c2.args = argsx;
      else
        argsx = c2.args;
      c2.returnValue = Cache.run<any>(c2, (...argsy: any[]): any => {
        return c2.config.body.call(this.handle.proxy, ...argsy);
      }, ...argsx);
      c2.outdated.timestamp = Number.MAX_SAFE_INTEGER;
      cc2.isUpToDate = c2.started === 0;
    }
    finally {
      c2.tryLeave(r2, c, mon);
    }
    return cc2;
  }

  private reconfigure(config: Partial<Config>): Config {
    let cc = this.read(false);
    let c: Cache = cc.cache;
    let r: Record = cc.record;
    let hint: string = Debug.verbosity > 2 ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : "configure";
    return Transaction.runAs<Config>(hint, false, 0, (): Config => {
      let cc2 = this.edit();
      let c2: Cache = cc2.cache;
      c2.config = new ConfigImpl(c2.config.body, c2.config, config);
      if (Debug.verbosity >= 4) Debug.log("║", "w", `${Hint.record(r)}.${c.member.toString()}.config = ...`);
      return c2.config;
    });
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
  error: any;
  started: number;
  readonly outdated: { timestamp: number, recomputation: Cache | undefined };
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
      this.result = init.result;
    }
    else {
      this.config = init;
      this.args = [];
      this.result = undefined;
    }
    // this.returnValue = undefined;
    // this.error = undefined;
    this.started = 0;
    this.outdated = { timestamp: 0, recomputation: undefined };
    this.observables = new Map<PropertyKey, Set<Record>>();
    this.hotObservables = new Map<PropertyKey, Set<Record>>();
  }

  hint(tranless?: boolean): string { return `${Hint.record(this.record, tranless, false, this.member)}`; }

  static get(method: F<any>): ReactiveCache<any> {
    let impl: ReactiveCache<any> | undefined = Utils.get(method, RT_CACHE);
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

  ensureUpToDate(timestamp: number, now: boolean, ...args: any[]): void {
    if (now || this.config.latency === Renew.Immediately) {
      if ((this.config.latency === Renew.DoesNotCache || timestamp >= this.outdated.timestamp) && !this.error) {
        let proxy: any = Utils.get(this.record.data, RT_HANDLE).proxy;
        let result: any = Reflect.get(proxy, this.member, proxy)(...args);
        if (result instanceof Promise)
          result.catch((error: any) => { /* nop */ }); // bad idea to hide an error
      }
    }
    else
      sleep(this.config.latency).then(() => this.ensureUpToDate(timestamp, true, ...args));
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
    let oo = r.observers.get(prop);
    if (oo && oo.size > 0) {
      let effect: ICache[] = [];
      oo.forEach((c: ICache) => c.markOutdated(r, prop, true, false, effect));
      r.observers.delete(prop);
      if (effect.length > 0)
        Transaction.ensureAllUpToDate(Hint.record(r), r.snapshot.timestamp,
          { tran: Transaction.active, effect });
    }
  }

  static applyDependencies(changeset: Map<Handle, Record>, effect: ICache[]): void {
    changeset.forEach((r: Record, h: Handle) => {
      let unmount: boolean = r.edits.has(RT_UNMOUNT);
      let prev: Record = r.prev.record;
      if (!unmount)
        r.edits.forEach((prop: PropertyKey) => {
          Cache.markOverwritten(r.prev.record, prop, effect);
          let value = r.data[prop];
          if (value instanceof Cache)
            value.subscribeToObservables(false, effect);
        });
      else
        for (let prop in prev.data)
          Cache.markOverwritten(prev, prop, effect);
    });
  }

  static acquireObserverSet(r: Record, prop: PropertyKey): Set<ICache> {
    let oo = r.observers.get(prop);
    if (!oo) {
      r.observers.set(prop, oo = new Set<Cache>());
      if (Debug.verbosity >= 5) Debug.log("", "   Observers:", `${Hint.record(r, false, false, prop)} = new`);
      let x: Record = r.prev.record;
      while (x !== Record.empty && !x.observers.get(prop) && x.data[prop] === r.data[prop]) { // "===" - workaround?
        x.observers.set(prop, oo);
        if (Debug.verbosity >= 5) Debug.log("", "   Observers:", `${Hint.record(x, false, false, prop)} = ${Hint.record(r, false, false, prop)}`);
        x = x.prev.record;
      }
    }
    return oo;
  }

  static acquireObservableSet(c: Cache, prop: PropertyKey, hot: boolean): Set<Record> {
    let o = hot ? c.hotObservables : c.observables;
    let result: Set<Record> | undefined = o.get(prop);
    if (!result)
      o.set(prop, result = new Set<Record>());
    return result;
  }

  private subscribeToObservables(hot: boolean, effect?: ICache[]): void {
    let subscriptions: string[] = [];
    let o = hot ? this.hotObservables : this.observables;
    o.forEach((observables: Set<Record>, prop: PropertyKey) => {
      observables.forEach((r: Record) => {
        Cache.acquireObserverSet(r, prop).add(this); // link
        if (Debug.verbosity >= 3) subscriptions.push(Hint.record(r, false, true, prop));
        if (effect && r.overwritten.has(prop))
          this.markOutdated(r, prop, hot, false, effect);
      });
    });
    if (Debug.verbosity >= 3 && subscriptions.length > 0) Debug.log(hot ? "║" : " ", "∞", `${Hint.record(this.record, false, false, this.member)} is subscribed to {${subscriptions.join(", ")}}.`);
  }

  // static mergeObservers(r: Record, prop: PropertyKey, prev: Record, prevObservers: Set<ICache>): Set<ICache> {
  //   let thisObservers: Set<ICache> | undefined = r.observers.get(prop);
  //   if (thisObservers) {
  //     thisObservers.forEach((c: ICache) => prevObservers.add(c));
  //     if (Debug.verbosity >= 5) Debug.log("", "   Observers:", `${Hint.record(prev, false, false, prop)}(${prevObservers.size}) += ${Hint.record(r, false, false, prop)}(${thisObservers.size})`);
  //   }
  //   r.observers.set(prop, prevObservers);
  //   if (Debug.verbosity >= 5) Debug.log("", "   Observers:", `${Hint.record(r, false, false, prop)} = ${Hint.record(prev, false, false, prop)}(${prevObservers.size})`);
  //   return prevObservers;
  // }

  markOutdated(cause: Record, causeProp: PropertyKey, hot: boolean, cascade: boolean, effect: ICache[]): void {
    const stamp = cause.snapshot.timestamp;
    if (this.outdated.timestamp === Number.MAX_SAFE_INTEGER && (!cascade || this.config.latency !== Renew.WhenReady)) {
      this.outdated.timestamp = stamp;
      // this.cause = Hint.record(cause, false, false, causeProp);
      // if (this.updater.active) {
      //   this.updater.active.tran.cancel();
      //   if (Debug.verbosity >= 2) Debug.log("║", " ", `Invalidation: t${this.updater.active.tran.id} is canceled.`);
      //   this.updater.active = undefined;
      // }
      // TODO: make cache readonly
      // Cascade invalidation
      let upper: Record = Snapshot.active().read(Utils.get(this.record.data, RT_HANDLE));
      if (upper.data[this.member] === this) { // TODO: Consider better solution?
        let r: Record = upper;
        while (r !== Record.empty && !r.overwritten.has(this.member)) {
          let oo = r.observers.get(this.member);
          if (oo)
            oo.forEach((c: ICache) => c.markOutdated(upper, this.member, false, true, effect));
          r = r.prev.record;
        }
      }
      // Check if cache should be renewed
      if (this.config.latency >= Renew.Immediately && upper.data[RT_UNMOUNT] !== RT_UNMOUNT) {
        effect.push(this);
        if (Debug.verbosity >= 2) Debug.log(" ", "■", `${this.hint(false)} is outdated due to ${Hint.record(cause, false, false, causeProp)} and will run automatically`);
      }
      else
        if (Debug.verbosity >= 2) Debug.log(" ", "□", `${this.hint(false)} is outdated due to ${Hint.record(cause, false, false, causeProp)}`);
    }
  }

  static enforceOutdated(c: Cache, cause: string, latency: number): boolean {
    throw new Error("not implemented");
    // let effect: Cache[] = [];
    // c.markOutdated(cause, false, false, effect);
    // if (latency === Renew.Immediately)
    //   Transaction.ensureAllUpToDate(cause, { effect });
    // else
    //   sleep(latency).then(() => Transaction.ensureAllUpToDate(cause, { effect }));
    // return true;
  }

  static markOverwritten(r: Record, prop: PropertyKey, effect: ICache[]): void {
    while (r !== Record.empty && !r.overwritten.has(prop)) {
      r.overwritten.add(prop);
      let oo = r.observers.get(prop);
      if (oo)
        oo.forEach((c: ICache) => c.markOutdated(r, prop, false, false, effect));
      // Utils.freezeSet(o);
      r = r.prev.record;
    }
  }

  static createCacheTrap(h: Handle, prop: PropertyKey, config: ConfigImpl): F<any> {
    let impl = new ReactiveCacheImpl(h, prop, config);
    let cachedInvoke: F<any> = (...args: any[]): any => impl.invoke(...args);
    Utils.set(cachedInvoke, RT_CACHE, impl);
    return cachedInvoke;
  }

  enter(r: Record, prev: Cache, mon: Monitor | null): void {
    if (this.config.tracing >= 4 || (this.config.tracing === 0 && Debug.verbosity >= 4)) Debug.log("║", "f =>", `${Hint.record(r, true)}.${this.member.toString()} is started`);
    this.started = Date.now();
    this.monitorEnter(mon);
    if (!prev.outdated.recomputation)
      prev.outdated.recomputation = this;
  }

  tryLeave(r: Record, prev: Cache, mon: Monitor | null): void {
    if (this.returnValue instanceof Promise) {
      this.returnValue = this.returnValue.then(
        result => {
          this.result = result;
          this.leave(r, prev, mon, "<=", "is completed");
          return result;
        },
        error => {
          this.error = error;
          this.leave(r, prev, mon, "<=", "is completed with error");
          throw error;
        });
      if (this.config.tracing >= 2 || (this.config.tracing === 0 && Debug.verbosity >= 2)) Debug.log("║", "f ..", `${Hint.record(r, true)}.${this.member.toString()} is async`);
    }
    else {
      this.result = this.returnValue;
      this.leave(r, prev, mon, "<=", "is completed");
    }
  }

  private leave(r: Record, prev: Cache, mon: Monitor | null, op: string, message: string): void {
    if (prev.outdated.recomputation === this)
      prev.outdated.recomputation = undefined;
    this.monitorLeave(mon);
    const ms: number = Date.now() - this.started;
    this.started = 0;
    if (this.config.tracing >= 2 || (this.config.tracing === 0 && Debug.verbosity >= 2)) Debug.log("║", `f ${op}`, `${Hint.record(r, true)}.${this.member.toString()} ${message}`, ms);
    // TODO: handle errors
    this.subscribeToObservables(true);
    this.hotObservables.clear();
    // Cache.freeze(this);
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
          Transaction.active = Transaction.head; // Workaround?
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
        result = false; // consistency of caches is checked via dependencies
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
      // if (Debug.verbosity >= 5) Debug.log("║", "", ` Promise.then (${(this as any)[RT_UNMOUNT]})`);
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
  Snapshot.active = Transaction._getActiveSnapshot; // override
  Transaction._init();
}

init();
