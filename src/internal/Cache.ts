import { Utils, Debug, sleep, rethrow, Record, ICachedResult, F, Handle, Snapshot, Hint, ConfigImpl, Virt, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from "./z.index";
import { ReactiveCache } from "../ReactiveCache";
export { ReactiveCache, recent } from "../ReactiveCache";
import { Config, Renew, ReentrantCall, ApartFrom } from "../Config";
import { Transaction } from "../Transaction";
import { Monitor } from "../Monitor";

interface CacheCall {
  record: Record;
  cached: CachedResult;
  isUpToDate: boolean;
}

class CachedMethod extends ReactiveCache<any> {
  private readonly handle: Handle;
  private readonly blank: CachedResult;

  get config(): Config { return this.read(false).cached.config; }
  configure(config: Partial<Config>): Config { return this.reconfigure(config); }
  get error(): boolean { return this.read(true).cached.error; }
  invalidate(cause: string | undefined): boolean { return cause ? CachedResult.enforceInvalidation(this.read(false).cached, cause, 0) : false; }
  get isComputing(): boolean { return this.read(true).cached.computing > 0; }
  get isUpdating(): boolean { return this.read(true).cached.invalidation.recomputation !== undefined; }

  constructor(handle: Handle, member: PropertyKey, config: ConfigImpl) {
    super();
    this.handle = handle;
    this.blank = new CachedResult(Record.empty, member, config);
    CachedResult.freeze(this.blank);
    // TODO: mark cache readonly?
  }

  recent(...args: any): any {
    let cc = this.obtain(false, ...args);
    if (cc.isUpToDate || cc.record.snapshot.completed)
      Record.markViewed(cc.record, cc.cached.member);
    else if (cc.record.prev.record !== Record.empty)
      Record.markViewed(cc.record.prev.record, cc.cached.member);
    return cc.cached.result;
  }

  get stamp(): number {
    let cc = this.obtain();
    let r = cc.isUpToDate ?  cc.record : cc.record.prev.record;
    if (r !== Record.empty)
      Record.markViewed(r, cc.cached.member);
    return r.snapshot.timestamp;
  }

  get isInvalidated(): boolean {
    let cc = this.obtain();
    let result = cc.cached.isInvalidated();
    if (result)
      Record.markViewed(cc.record, cc.cached.member);
    else if (cc.record.prev.record !== Record.empty)
      Record.markViewed(cc.record.prev.record, cc.cached.member);
    // Record.markViewed(cc.record, cc.cache.member);
    return result;
  }

  invoke(...args: any[]): any {
    let cc = this.obtain(true, ...args);
    Record.markViewed(cc.record, cc.cached.member);
    return cc.cached.ret;
  }

  obtain(invoke?: boolean, ...args: any[]): CacheCall {
    let cc = this.read(false);
    let c: CachedResult = cc.cached;
    let hit = (cc.isUpToDate || c.computing > 0) &&
      c.config.latency !== Renew.NoCache &&
      c.args[0] === args[0] ||
      cc.record.data[RT_UNMOUNT] === RT_UNMOUNT;
    // if (Debug.verbosity >= 3 && c.invalidation.recomputation) Debug.log("", "    ‼", `${Hint.record(cc.record)}.${c.member.toString()} is concurrent`);
    if (!hit) {
      if (invoke !== undefined && (!c.invalidation.recomputation || invoke)) {
        if (c.invalidation.recomputation) {
          if (c.config.reentrant === ReentrantCall.ExitWithError && c.config.reentrant >= 1)
            throw new Error(`[E609] ${c.hint()} is already running and reached the maximum of simultaneous calls (${c.config.mode})`);
        }
        let hint: string = (c.config.tracing >= 2 || Debug.verbosity >= 2) ? `${Hint.handle(this.handle)}.${c.member.toString()}${args.length > 0 ? `/${args[0]}` : ""}` : "recache";
        let ret = Transaction.runAs<any>(hint, c.config.apart, c.config.tracing, (...argsx: any[]): any => {
          cc = this.recache(cc, ...argsx);
          return cc.cached.ret;
        }, ...args);
        cc.cached.ret = ret;
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
    let c: CachedResult = r.data[member] || this.blank;
    let isUpToDate = ctx.timestamp < c.invalidation.timestamp && c.computing === 0;
    if (markViewed)
      Record.markViewed(r, c.member);
    return { cached: c, record: r, isUpToDate };
  }

  private edit(): CacheCall {
    let ctx = Snapshot.active();
    let member = this.blank.member;
    let r: Record = ctx.edit(this.handle, member, RT_CACHE);
    let c: CachedResult = r.data[member] || this.blank;
    let isUpToDate = ctx.timestamp < c.invalidation.timestamp;
    if ((!isUpToDate && (c.record !== r || c.computing === 0)) ||
        c.config.latency === Renew.NoCache) {
      let c2 = new CachedResult(r, c.member, c);
      r.data[c2.member] = c2;
      if (Debug.verbosity >= 5) Debug.log("║", " ", `${c2.hint(false)} is being recached over ${c === this.blank ? "blank" : c.hint(false)}`);
      Record.markEdited(r, c2.member, true, RT_CACHE);
      c = c2;
    }
    return { cached: c, record: r, isUpToDate };
  }

  private recache(cc: CacheCall, ...argsx: any[]): CacheCall {
    let c = cc.cached;
    let existing = c.invalidation.recomputation;
    if (existing && (
        c.config.reentrant === ReentrantCall.DiscardPrevious ||
        c.config.reentrant === ReentrantCall.DiscardPreviousNoWait)) {
      existing.tran.discard(); // ignore silently
      c.invalidation.recomputation = undefined;
      if (Debug.verbosity >= 3) Debug.log("║", " ", `transaction t${existing.tran.id} (${existing.tran.hint}) is discarded by reentrant call of ${cc.cached.hint(true)}`);
    }
    let cc2 = this.edit();
    let c2: CachedResult = cc2.cached;
    let r2: Record = cc2.record;
    let mon: Monitor | null = c.config.monitor;
    c2.enter(r2, c, mon);
    try
    {
      // TODO: To fix this logic - it causes confusion when calling methods with optional parameters
      if (argsx.length > 0)
        c2.args = argsx;
      else
        argsx = c2.args;
      if (existing && c2 !== existing && (
          c.config.reentrant === ReentrantCall.WaitAndRestart ||
          c.config.reentrant === ReentrantCall.DiscardPrevious)) {
        const error = new Error(`transaction will be restarted after t${existing.tran.id} (${existing.tran.hint})`);
        c2.ret = Promise.reject(error);
        Transaction.active.discard(error, existing.tran);
        if (Debug.verbosity >= 3) Debug.log("║", " ", error.message);
      }
      else {
        c2.ret = CachedResult.run<any>(c2, (...argsy: any[]): any => {
          return c2.config.body.call(this.handle.proxy, ...argsy);
        }, ...argsx);
      }
      c2.invalidation.timestamp = Number.MAX_SAFE_INTEGER;
    }
    finally {
      c2.tryLeave(r2, c, mon);
    }
    cc2.isUpToDate = c2.computing === 0;
    return cc2;
  }

  private reconfigure(config: Partial<Config>): Config {
    let cc = this.read(false);
    let c: CachedResult = cc.cached;
    let r: Record = cc.record;
    let hint: string = Debug.verbosity > 2 ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : "configure";
    return Transaction.runAs<Config>(hint, ApartFrom.Reaction, 0, (): Config => {
      let cc2 = this.edit();
      let c2: CachedResult = cc2.cached;
      c2.config = new ConfigImpl(c2.config.body, c2.config, config);
      if (Debug.verbosity >= 5) Debug.log("║", "w", `${Hint.record(r)}.${c.member.toString()}.config = ...`);
      return c2.config;
    });
  }
}

// CacheResult

export class CachedResult implements ICachedResult {
  static active?: CachedResult = undefined;
  readonly margin: number;
  readonly tran: Transaction;
  readonly record: Record;
  readonly member: PropertyKey;
  config: ConfigImpl;
  args: any[];
  ret: any;
  result: any;
  error: any;
  computing: number;
  readonly invalidation: { timestamp: number, recomputation: CachedResult | undefined };
  readonly observables: Map<PropertyKey, Set<Record>>;
  readonly hotObservables: Map<PropertyKey, Set<Record>>;

  constructor(record: Record, member: PropertyKey, init: CachedResult | ConfigImpl) {
    this.margin = Debug.margin + 1;
    this.tran = Transaction.active;
    this.record = record;
    this.member = member;
    if (init instanceof CachedResult) {
      this.config = init.config;
      this.args = init.args;
      this.result = init.result;
    }
    else {
      this.config = init;
      this.args = [];
      this.result = undefined;
    }
    // this.ret = undefined;
    // this.error = undefined;
    this.computing = 0;
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

  static run<T>(c: CachedResult | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined;
    let outer = CachedResult.active;
    let outerVerbosity = Debug.verbosity;
    let outerMargin = Debug.margin;
    try {
      CachedResult.active = c;
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
      CachedResult.active = outer;
    }
    return result;
  }

  wrap<T>(func: F<T>): F<T> {
    let caching: F<T> = (...args: any[]): T => CachedResult.run<T>(this, func, ...args);
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
        let cachedMethod: CachedMethod = Utils.get(trap, RT_CACHE);
        // let result: any = trap(...args);
        let cc = cachedMethod.obtain(false, ...args);
        if (cc.cached.ret instanceof Promise)
          cc.cached.ret.catch(error => { /* nop */ }); // bad idea to hide an error
      }
    }
    else
      sleep(this.config.latency).then(() => this.triggerRecache(timestamp, true, ...args));
  }

  static markViewed(r: Record, prop: PropertyKey): void {
    const c: CachedResult | undefined = CachedResult.active; // alias
    if (c && c.config.latency >= Renew.Manually && prop !== RT_HANDLE) {
      CachedResult.acquireObservableSet(c, prop, c.tran.id === r.snapshot.id).add(r);
      if (Debug.verbosity >= 5) Debug.log("║", "r", `${c.hint(true)} uses ${Hint.record(r)}.${prop.toString()}`);
    }
  }

  static markEdited(r: Record, prop: PropertyKey, edited: boolean, value: any): void {
    edited ? r.edits.add(prop) : r.edits.delete(prop);
    if (Debug.verbosity >= 5) Debug.log("║", "w", `${Hint.record(r, true)}.${prop.toString()} = ${Utils.valueHint(value)}`);
    let oo = r.observers.get(prop);
    if (oo && oo.size > 0) {
      let effect: ICachedResult[] = [];
      oo.forEach(c => c.invalidate(r, prop, true, false, effect));
      r.observers.delete(prop);
      if (effect.length > 0)
        Transaction.triggerRecacheAll(Hint.record(r), r.snapshot.timestamp,
          { tran: Transaction.active, effect });
    }
  }

  static applyDependencies(changeset: Map<Handle, Record>, effect: ICachedResult[]): void {
    changeset.forEach((r: Record, h: Handle) => {
      if (!r.edits.has(RT_UNMOUNT))
        r.edits.forEach(prop => {
          CachedResult.markPrevAsOutdated(r, prop, effect);
          let value = r.data[prop];
          if (value instanceof CachedResult)
            value.subscribeToObservables(false, effect);
        });
      else
        for (let prop in r.prev.record.data)
          CachedResult.markPrevAsOutdated(r, prop, effect);
    });
    changeset.forEach((r: Record, h: Handle) => {
      Snapshot.mergeObservers(r, r.prev.record);
    });
  }

  static acquireObserverSet(r: Record, prop: PropertyKey): Set<ICachedResult> {
    let oo = r.observers.get(prop);
    if (!oo)
      r.observers.set(prop, oo = new Set<CachedResult>());
    return oo;
  }

  static acquireObservableSet(c: CachedResult, prop: PropertyKey, hot: boolean): Set<Record> {
    let o = hot ? c.hotObservables : c.observables;
    let result: Set<Record> | undefined = o.get(prop);
    if (!result)
      o.set(prop, result = new Set<Record>());
    return result;
  }

  private subscribeToObservables(hot: boolean, effect?: ICachedResult[]): void {
    let subscriptions: string[] = [];
    let o = hot ? this.hotObservables : this.observables;
    o.forEach((observables: Set<Record>, prop: PropertyKey) => {
      observables.forEach(r => {
        CachedResult.acquireObserverSet(r, prop).add(this); // link
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

  invalidate(cause: Record, causeProp: PropertyKey, hot: boolean, cascade: boolean, effect: ICachedResult[]): void {
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

  static enforceInvalidation(c: CachedResult, cause: string, latency: number): boolean {
    throw new Error("[E600] not implemented - Cache.enforceInvalidation");
    // let effect: Cache[] = [];
    // c.invalidate(cause, false, false, effect);
    // if (latency === Renew.Immediately)
    //   Transaction.ensureAllUpToDate(cause, { effect });
    // else
    //   sleep(latency).then(() => Transaction.ensureAllUpToDate(cause, { effect }));
    // return true;
  }

  static markPrevAsOutdated(r: Record, prop: PropertyKey, effect: ICachedResult[]): void {
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

  static createCachedMethodTrap(h: Handle, prop: PropertyKey, config: ConfigImpl): F<any> {
    let cachedMethod = new CachedMethod(h, prop, config);
    let cachedMethodTrap: F<any> = (...args: any[]): any => cachedMethod.invoke(...args);
    Utils.set(cachedMethodTrap, RT_CACHE, cachedMethod);
    return cachedMethodTrap;
  }

  enter(r: Record, prev: CachedResult, mon: Monitor | null): void {
    if (this.config.tracing >= 2 || (this.config.tracing === 0 && Debug.verbosity >= 2)) Debug.log("║", "  ‾\\", `${Hint.record(r, true)}.${this.member.toString()} - enter`);
    this.computing = Date.now();
    this.monitorEnter(mon);
    if (!prev.invalidation.recomputation)
      prev.invalidation.recomputation = this;
  }

  tryLeave(r: Record, prev: CachedResult, mon: Monitor | null): void {
    if (this.ret instanceof Promise) {
      this.ret = this.ret.then(
        result => {
          this.result = result;
          this.leave(r, prev, mon, "██", "is resolved");
          return result;
        },
        error => {
          this.error = error;
          this.leave(r, prev, mon, "██", "is resolved with error");
          throw error;
        });
      // Utils.set(this.ret, RT_CACHE, this);
      if (this.config.tracing >= 2 || (this.config.tracing === 0 && Debug.verbosity >= 2)) Debug.log("║", "  _/", `${Hint.record(r, true)}.${this.member.toString()} - leave...`, 0, "ASYNC");
    }
    else {
      this.result = this.ret;
      this.leave(r, prev, mon, "_/", "- leave");
    }
  }

  private leave(r: Record, prev: CachedResult, mon: Monitor | null, op: string, message: string, highlight: string | undefined = undefined): void {
    if (prev.invalidation.recomputation === this)
      prev.invalidation.recomputation = undefined;
    this.monitorLeave(mon);
    const ms: number = Date.now() - this.computing;
    this.computing = 0;
    if (this.config.tracing >= 2 || (this.config.tracing === 0 && Debug.verbosity >= 2)) Debug.log("║", `  ${op}`, `${Hint.record(r, true)}.${this.member.toString()} ${message}`, ms, highlight);
    // TODO: handle errors
    this.subscribeToObservables(true);
    this.hotObservables.clear();
    // Cache.freeze(this);
  }

  monitorEnter(mon: Monitor | null): void {
    if (mon)
      Transaction.runAs<void>("Monitor.enter", mon.apart, 0,
        CachedResult.run, undefined, () => mon.enter(this));
  }

  monitorLeave(mon: Monitor | null): void {
    if (mon) {
      if (mon.prolonged) {
        let outer = Transaction.active;
        try {
          Transaction.active = Transaction.nope; // Workaround?
          let leave = () => {
            Transaction.runAs<void>("Monitor.leave", mon.apart, 0,
              CachedResult.run, undefined, () => mon.leave(this));
          };
          this.tran.whenFinished(false).then(leave, leave);
        }
        finally {
          Transaction.active = outer;
        }
      }
      else
        Transaction.runAs<void>("Monitor.leave", mon.apart, 0,
          CachedResult.run, undefined, () => mon.leave(this));
    }
  }

  static differentImpl(oldValue: any, newValue: any): boolean {
    let result: boolean;
    if (oldValue instanceof CachedResult) {
      if (newValue instanceof CachedResult)
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

  static freeze(c: CachedResult): void {
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
      onsuccess = Transaction._wrap<any>(t, CachedResult.active, true, true, onsuccess);
      onfailure = Transaction._wrap<any>(t, CachedResult.active, false, true, onfailure || rethrow);
    }
    else if (onfailure)
      onfailure = Transaction._wrap<any>(t, CachedResult.active, false, false, onfailure);
  }
  return original_primise_then.call(this, onsuccess, onfailure);
};

function init(): void {
  Utils.different = CachedResult.differentImpl; // override
  Record.markViewed = CachedResult.markViewed; // override
  Record.markEdited = CachedResult.markEdited; // override
  Snapshot.applyDependencies = CachedResult.applyDependencies; // override
  Virt.createCachedMethodTrap = CachedResult.createCachedMethodTrap; // override
  Snapshot.active = Transaction._getActiveSnapshot; // override
  Transaction._init();
}

init();
