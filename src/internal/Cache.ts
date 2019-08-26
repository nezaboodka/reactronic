import { Utils, Debug, sleep, rethrow, Record, ICache, F, Handle, Snapshot, Hint, ConfigImpl, Virt, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from "./z.index";
import { ReactiveCache } from "../ReactiveCache";
export { ReactiveCache } from "../ReactiveCache";
import { Config, Renew, Reentrance, ApartFrom } from "../Config";
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
  get error(): boolean { return this.read(true).cache.error; }
  invalidate(cause: string | undefined): boolean { return cause ? Cache.enforceInvalidation(this.read(false).cache, cause, 0) : false; }
  get isComputing(): boolean { return this.read(true).cache.started > 0; }
  get isUpdating(): boolean { return this.read(true).cache.invalidation.recomputation !== undefined; }

  constructor(handle: Handle, member: PropertyKey, config: ConfigImpl) {
    super();
    this.handle = handle;
    this.blank = new Cache(Record.empty, member, config);
    Cache.freeze(this.blank);
    // TODO: mark cache readonly?
  }

  getRecentValueAndValidate(...args: any): any {
    let cc = this.obtain(false, ...args);
    if (cc.isUpToDate)
      Record.markViewed(cc.record, cc.cache.member);
    else if (cc.record.prev.record !== Record.empty)
      Record.markViewed(cc.record.prev.record, cc.cache.member);
    return cc.cache.value;
  }

  get stamp(): number {
    let cc = this.obtain();
    let r = cc.isUpToDate ?  cc.record : cc.record.prev.record;
    if (r !== Record.empty)
      Record.markViewed(r, cc.cache.member);
    return r.snapshot.timestamp;
  }

  get isInvalidated(): boolean {
    let cc = this.obtain();
    let result = cc.cache.isInvalidated();
    if (result)
      Record.markViewed(cc.record, cc.cache.member);
    else if (cc.record.prev.record !== Record.empty)
      Record.markViewed(cc.record.prev.record, cc.cache.member);
    // Record.markViewed(cc.record, cc.cache.member);
    return result;
  }

  invoke(...args: any[]): any {
    let cc = this.obtain(true, ...args);
    Record.markViewed(cc.record, cc.cache.member);
    return cc.cache.resultOfInvoke;
  }

  obtain(invoke?: boolean, ...args: any[]): CacheCall {
    let cc = this.read(false);
    let c: Cache = cc.cache;
    let hit = (cc.isUpToDate || c.started > 0) &&
      c.config.latency !== Renew.NoCache &&
      c.args[0] === args[0] ||
      cc.record.data[RT_UNMOUNT] === RT_UNMOUNT;
    // if (Debug.verbosity >= 3 && c.invalidation.recomputation) Debug.log("", "    ‼", `${Hint.record(cc.record)}.${c.member.toString()} is concurrent`);
    if (!hit) {
      if (invoke !== undefined && (!c.invalidation.recomputation || invoke)) {
        if (c.invalidation.recomputation) {
          if (c.config.reentrance === Reentrance.Prevent && c.config.reentrance >= 1)
            throw new Error(`[E609] ${c.hint()} is already running and reached the maximum of simultaneous calls (${c.config.reentrance})`);
        }
        let hint: string = (c.config.tracing >= 2 || Debug.verbosity >= 2) ? `${Hint.handle(this.handle)}.${c.member.toString()}${args.length > 0 ? `/${args[0]}` : ""}` : "recache";
        let result = Transaction.runAs<any>(hint, c.config.apart, c.config.tracing, (...argsx: any[]): any => {
          cc = this.recache(cc, ...argsx);
          return cc.cache.resultOfInvoke;
        }, ...args);
        cc.cache.resultOfInvoke = result;
      }
    }
    else
      if (Debug.verbosity >= 4) Debug.log("║", "  ==", `${Hint.record(cc.record)}.${c.member.toString()}() hits cache`);
    return cc;
  }

  private read(markViewed: boolean): CacheCall {
    let ctx = Snapshot.active();
    let member = this.blank.member;
    let r: Record = ctx.tryRead(this.handle);
    let c: Cache = r.data[member] || this.blank;
    let isUpToDate = ctx.timestamp < c.invalidation.timestamp && c.started === 0;
    if (markViewed)
      Record.markViewed(r, c.member);
    return { cache: c, record: r, isUpToDate };
  }

  private edit(): CacheCall {
    let ctx = Snapshot.active();
    let member = this.blank.member;
    let r: Record = ctx.edit(this.handle, member, RT_CACHE);
    let c: Cache = r.data[member] || this.blank;
    let isUpToDate = ctx.timestamp < c.invalidation.timestamp;
    if ((!isUpToDate && (c.record !== r || c.started === 0)) || c.config.latency === Renew.NoCache) {
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
    let existing = c.invalidation.recomputation;
    if (existing && c.config.reentrance === Reentrance.DiscardPreceding) {
      existing.tran.discard(); // ignore silently
      c.invalidation.recomputation = undefined;
      if (Debug.verbosity >= 3) Debug.log("║", " ", `Transaction t${existing.tran.id} is discarded and being relayed`);
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
      if (existing && c2 !== existing && c.config.reentrance === Reentrance.WaitAndRestart) {
        const error = new Error(`Transaction will be restarted after t${existing.tran.id}`);
        c2.resultOfInvoke = Promise.reject(error);
        Transaction.active.discard(error, existing.tran);
        if (Debug.verbosity >= 3) Debug.log("║", " ", error.message);
      }
      else {
        c2.resultOfInvoke = Cache.run<any>(c2, (...argsy: any[]): any => {
          return c2.config.body.call(this.handle.proxy, ...argsy);
        }, ...argsx);
      }
      c2.invalidation.timestamp = Number.MAX_SAFE_INTEGER;
    }
    finally {
      c2.tryLeave(r2, c, mon);
    }
    cc2.isUpToDate = c2.started === 0;
    return cc2;
  }

  private reconfigure(config: Partial<Config>): Config {
    let cc = this.read(false);
    let c: Cache = cc.cache;
    let r: Record = cc.record;
    let hint: string = Debug.verbosity > 2 ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : "configure";
    return Transaction.runAs<Config>(hint, ApartFrom.Reaction, 0, (): Config => {
      let cc2 = this.edit();
      let c2: Cache = cc2.cache;
      c2.config = new ConfigImpl(c2.config.body, c2.config, config);
      if (Debug.verbosity >= 5) Debug.log("║", "w", `${Hint.record(r)}.${c.member.toString()}.config = ...`);
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
  resultOfInvoke: any;
  value: any;
  error: any;
  started: number;
  readonly invalidation: { timestamp: number, recomputation: Cache | undefined };
  readonly observables: Map<PropertyKey, Set<Record>>;
  readonly hotObservables: Map<PropertyKey, Set<Record>>;

  constructor(record: Record, member: PropertyKey, init: Cache | ConfigImpl) {
    this.margin = Debug.margin + 1;
    this.tran = Transaction.active;
    this.record = record;
    this.member = member;
    if (init instanceof Cache) {
      this.config = init.config;
      this.args = init.args;
      this.value = init.value;
    }
    else {
      this.config = init;
      this.args = [];
      this.value = undefined;
    }
    // this.returnValue = undefined;
    // this.error = undefined;
    this.started = 0;
    this.invalidation = { timestamp: 0, recomputation: undefined };
    this.observables = new Map<PropertyKey, Set<Record>>();
    this.hotObservables = new Map<PropertyKey, Set<Record>>();
  }

  hint(tranless?: boolean): string { return `${Hint.record(this.record, tranless, false, this.member)}`; }

  static get(method: F<any>): ReactiveCache<any> {
    let impl: ReactiveCache<any> | undefined = Utils.get(method, RT_CACHE);
    if (!impl)
      throw new Error("[E610] given method is not a reactronic cache");
    return impl;
  }

  static run<T>(c: Cache | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined;
    let outer = Cache.active;
    let outerVerbosity = Debug.verbosity;
    let outerMargin = Debug.margin;
    try {
      Cache.active = c;
      if (c) {
        if (c.config.tracing !== 0)
          Debug.verbosity = c.config.tracing;
        Debug.margin = c.margin;
      }
      result = func(...args);
    }
    catch (e) {
      if (c)
        c.error = e;
      throw e;
    }
    finally {
      Debug.margin = outerMargin;
      Debug.verbosity = outerVerbosity;
      Cache.active = outer;
    }
    return result;
  }

  wrap<T>(func: F<T>): F<T> {
    let caching: F<T> = (...args: any[]): T => Cache.run<T>(this, func, ...args);
    return caching;
  }

  triggerRecache(timestamp: number, now: boolean, ...args: any[]): void {
    if (now || this.config.latency === Renew.Immediately) {
      if (!this.error && (this.config.latency === Renew.NoCache ||
          (timestamp >= this.invalidation.timestamp && !this.invalidation.recomputation))) {
        // let proxy = this.record.data
        // let cachedInvoke = this.record.data[this.member];
        let proxy: any = Utils.get(this.record.data, RT_HANDLE).proxy;
        let trap: Function = Reflect.get(proxy, this.member, proxy);
        let impl: ReactiveCacheImpl = Utils.get(trap, RT_CACHE);
        // let result: any = trap(...args);
        let cc = impl.obtain(false, ...args);
        if (cc.cache.resultOfInvoke instanceof Promise)
          cc.cache.resultOfInvoke.catch(error => { /* nop */ }); // bad idea to hide an error
      }
    }
    else
      sleep(this.config.latency).then(() => this.triggerRecache(timestamp, true, ...args));
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
    if (Debug.verbosity >= 5) Debug.log("║", "w", `${Hint.record(r, true)}.${prop.toString()} = ${Utils.valueHint(value)}`);
    let oo = r.observers.get(prop);
    if (oo && oo.size > 0) {
      let effect: ICache[] = [];
      oo.forEach(c => c.invalidate(r, prop, true, false, effect));
      r.observers.delete(prop);
      if (effect.length > 0)
        Transaction.triggerRecacheAll(Hint.record(r), r.snapshot.timestamp,
          { tran: Transaction.active, effect });
    }
  }

  static applyDependencies(changeset: Map<Handle, Record>, effect: ICache[]): void {
    changeset.forEach((r: Record, h: Handle) => {
      if (!r.edits.has(RT_UNMOUNT))
        r.edits.forEach(prop => {
          Cache.markPrevAsOutdated(r, prop, effect);
          let value = r.data[prop];
          if (value instanceof Cache)
            value.subscribeToObservables(false, effect);
        });
      else
        for (let prop in r.prev.record.data)
          Cache.markPrevAsOutdated(r, prop, effect);
    });
    changeset.forEach((r: Record, h: Handle) => {
      Snapshot.mergeObservers(r, r.prev.record);
    });
  }

  static acquireObserverSet(r: Record, prop: PropertyKey): Set<ICache> {
    let oo = r.observers.get(prop);
    if (!oo)
      r.observers.set(prop, oo = new Set<Cache>());
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
      observables.forEach(r => {
        Cache.acquireObserverSet(r, prop).add(this); // link
        if (Debug.verbosity >= 3) subscriptions.push(Hint.record(r, false, true, prop));
        if (effect && r.outdated.has(prop))
          this.invalidate(r, prop, hot, false, effect);
      });
    });
    if (Debug.verbosity >= 3 && subscriptions.length > 0) Debug.log(hot ? "║" : " ", "∞", `${Hint.record(this.record, false, false, this.member)} is subscribed to {${subscriptions.join(", ")}}.`);
  }

  isInvalidated(): boolean {
    const t = this.invalidation.timestamp;
    return t !== Number.MAX_SAFE_INTEGER && t !== 0;
  }

  invalidate(cause: Record, causeProp: PropertyKey, hot: boolean, cascade: boolean, effect: ICache[]): void {
    const stamp = cause.snapshot.timestamp;
    if (this.invalidation.timestamp === Number.MAX_SAFE_INTEGER && (!cascade || this.config.latency !== Renew.WhenReady)) {
      this.invalidation.timestamp = stamp;
      // this.cause = Hint.record(cause, false, false, causeProp);
      // if (this.updater.active) {
      //   this.updater.active.tran.discard();
      //   if (Debug.verbosity >= 2) Debug.log("║", " ", `Invalidation: t${this.updater.active.tran.id} is discarded.`);
      //   this.updater.active = undefined;
      // }
      // TODO: make cache readonly
      // Cascade invalidation
      let upper: Record = Snapshot.active().read(Utils.get(this.record.data, RT_HANDLE));
      if (upper.data[this.member] === this) { // TODO: Consider better solution?
        let r: Record = upper;
        while (r !== Record.empty && !r.outdated.has(this.member)) {
          let oo = r.observers.get(this.member);
          if (oo)
            oo.forEach(c => c.invalidate(upper, this.member, false, true, effect));
          r = r.prev.record;
        }
      }
      // Check if cache should be renewed
      if (this.config.latency >= Renew.Immediately && upper.data[RT_UNMOUNT] !== RT_UNMOUNT) {
        effect.push(this);
        if (Debug.verbosity >= 2) Debug.log(" ", "■", `${this.hint(false)} is invalidated by ${Hint.record(cause, false, false, causeProp)} and will run automatically`);
      }
      else
        if (Debug.verbosity >= 2) Debug.log(" ", "□", `${this.hint(false)} is invalidated by ${Hint.record(cause, false, false, causeProp)}`);
    }
  }

  static enforceInvalidation(c: Cache, cause: string, latency: number): boolean {
    throw new Error("[E600] not implemented - Cache.enforceInvalidation");
    // let effect: Cache[] = [];
    // c.invalidate(cause, false, false, effect);
    // if (latency === Renew.Immediately)
    //   Transaction.ensureAllUpToDate(cause, { effect });
    // else
    //   sleep(latency).then(() => Transaction.ensureAllUpToDate(cause, { effect }));
    // return true;
  }

  static markPrevAsOutdated(r: Record, prop: PropertyKey, effect: ICache[]): void {
    let cause = r;
    r = r.prev.record;
    while (r !== Record.empty && !r.outdated.has(prop)) {
      r.outdated.add(prop);
      let oo = r.observers.get(prop);
      if (oo)
        oo.forEach(c => c.invalidate(cause, prop, false, false, effect));
      // Utils.freezeSet(o);
      r = r.prev.record;
    }
  }

  static createCachedInvoke(h: Handle, prop: PropertyKey, config: ConfigImpl): F<any> {
    let impl = new ReactiveCacheImpl(h, prop, config);
    let cachedInvoke: F<any> = (...args: any[]): any => impl.invoke(...args);
    Utils.set(cachedInvoke, RT_CACHE, impl);
    return cachedInvoke;
  }

  enter(r: Record, prev: Cache, mon: Monitor | null): void {
    if (this.config.tracing >= 4 || (this.config.tracing === 0 && Debug.verbosity >= 4)) Debug.log("║", "  =>", `${Hint.record(r, true)}.${this.member.toString()} is started`);
    this.started = Date.now();
    this.monitorEnter(mon);
    if (!prev.invalidation.recomputation)
      prev.invalidation.recomputation = this;
  }

  tryLeave(r: Record, prev: Cache, mon: Monitor | null): void {
    if (this.resultOfInvoke instanceof Promise) {
      this.resultOfInvoke = this.resultOfInvoke.then(
        result => {
          this.value = result;
          this.leave(r, prev, mon, "<:", "is completed");
          return result;
        },
        error => {
          this.error = error;
          this.leave(r, prev, mon, "<:", "is completed with error");
          throw error;
        });
      if (this.config.tracing >= 2 || (this.config.tracing === 0 && Debug.verbosity >= 2)) Debug.log("║", "  :>", `${Hint.record(r, true)}.${this.member.toString()} is async...`);
    }
    else {
      this.value = this.resultOfInvoke;
      this.leave(r, prev, mon, "<=", "is completed");
    }
  }

  private leave(r: Record, prev: Cache, mon: Monitor | null, op: string, message: string): void {
    if (prev.invalidation.recomputation === this)
      prev.invalidation.recomputation = undefined;
    this.monitorLeave(mon);
    const ms: number = Date.now() - this.started;
    this.started = 0;
    if (this.config.tracing >= 2 || (this.config.tracing === 0 && Debug.verbosity >= 2)) Debug.log("║", `  ${op}`, `${Hint.record(r, true)}.${this.member.toString()} ${message}`, ms);
    // TODO: handle errors
    this.subscribeToObservables(true);
    this.hotObservables.clear();
    // Cache.freeze(this);
  }

  monitorEnter(mon: Monitor | null): void {
    if (mon)
      Transaction.runAs<void>("Monitor.enter", mon.apart, 0,
        Cache.run, undefined, () => mon.enter(this));
  }

  monitorLeave(mon: Monitor | null): void {
    if (mon) {
      if (mon.prolonged) {
        let outer = Transaction.active;
        try {
          Transaction.active = Transaction.nope; // Workaround?
          let leave = () => {
            Transaction.runAs<void>("Monitor.leave", mon.apart, 0,
              Cache.run, undefined, () => mon.leave(this));
          };
          this.tran.whenFinished(false).then(leave, leave);
        }
        finally {
          Transaction.active = outer;
        }
      }
      else
        Transaction.runAs<void>("Monitor.leave", mon.apart, 0,
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
    Transaction.runAs<void>("unmount", ApartFrom.Reaction, 0, (): void => {
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
  Virt.createCachedInvoke = Cache.createCachedInvoke; // override
  Snapshot.active = Transaction._getActiveSnapshot; // override
  Transaction._init();
}

init();
