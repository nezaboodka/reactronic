import { Utils, Trace as T, sleep, rethrow, Record, ICachedResult, F, Handle, Snapshot, Hint, ConfigRecord, Virt, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from "./z.index";
import { ReactiveCache } from "../ReactiveCache";
export { ReactiveCache, resultof } from "../ReactiveCache";
import { Config, Renew, ReentrantCall, SeparateFrom } from "../Config";
import { Transaction } from "../Transaction";
import { Monitor } from "../Monitor";

const UNDEFINED_TIMESTAMP = Number.MAX_SAFE_INTEGER;
type CachedCall = { cache: CachedResult, record: Record, ok: boolean };

class CachedMethod extends ReactiveCache<any> {
  private readonly handle: Handle;
  private readonly empty: CachedResult;

  get config(): Config { return this.read(false).cache.config; }
  configure(config: Partial<Config>): Config { return this.reconfigure(config); }
  get stamp(): number { return this.read(true).record.snapshot.timestamp; }
  get error(): boolean { return this.read(true).cache.error; }
  getResult(...args: any): any { return this.call(false, args).cache.result; }
  get isOutdated(): boolean { return this.read(true).cache.isOutdated(); }
  markOutdated(cause: string | undefined): boolean { return cause ? CachedResult.enforceMarkOutdated(this.read(false).cache, cause, 0) : false; }

  constructor(handle: Handle, member: PropertyKey, config: ConfigRecord) {
    super();
    this.handle = handle;
    this.empty = new CachedResult(Record.empty, member, config);
    CachedResult.freeze(this.empty);
    // TODO: mark cache readonly?
  }

  call(recache: boolean, args?: any[]): CachedCall {
    let call: CachedCall = this.read(false, args);
    if (!call.ok) {
      const c: CachedResult = call.cache;
      const hint: string = (c.config.tracing >= 2 || T.level >= 2) ? `${Hint.handle(this.handle)}.${c.member.toString()}${args && args.length > 0 ? `/${args[0]}` : ""}` : /* istanbul ignore next */ "recache";
      const separate = recache ? c.config.separate : (c.config.separate | SeparateFrom.Parent);
      let call2 = call;
      const ret = Transaction.runAs<any>(hint, separate, c.config.tracing, (argsx: any[] | undefined): any => {
        // TODO: Cleaner implementation is needed
        if (call2.cache.tran.isCanceled()) {
          call2 = this.read(false, argsx); // re-read on retry
          if (!call2.ok)
            call2 = this.recache(call2.cache, argsx);
        }
        else
          call2 = this.recache(call2.cache, argsx);
        return call2.cache.ret;
      }, args);
      call2.cache.ret = ret;
      if (recache)
        call = call2;
    }
    else
      if (T.level >= 2) T.log("║", "  ==", `${Hint.record(call.record)}.${call.cache.member.toString()} is reused (cached by ${call.cache.tran.hint})`);
    Record.markViewed(call.record, call.cache.member);
    return call;
  }

  private read(markViewed: boolean, args?: any[]): CachedCall {
    const ctx = Snapshot.active();
    const member = this.empty.member;
    const r: Record = ctx.tryRead(this.handle);
    const c: CachedResult = r.data[member] || this.empty;
    const ok = c.config.latency !== Renew.NoCache &&
      ctx.timestamp < c.outdated.timestamp &&
      (args === undefined || c.args[0] === args[0]) ||
      r.data[RT_UNMOUNT] === RT_UNMOUNT;
    if (markViewed)
      Record.markViewed(r, c.member);
    return { cache: c, record: r, ok };
  }

  private write(): CachedCall {
    const ctx = Snapshot.active();
    const member = this.empty.member;
    const r: Record = ctx.write(this.handle, member, RT_CACHE);
    let c: CachedResult = r.data[member] || this.empty;
    if (c.record !== r) {
      const c2 = new CachedResult(r, c.member, c);
      r.data[c2.member] = c2;
      if (T.level >= 3) T.log("║", " ", `${c2.hint(false)} is being recached over ${c === this.empty ? "empty" : c.hint(false)}`);
      Record.markChanged(r, c2.member, true, RT_CACHE);
      c = c2;
    }
    return { cache: c, record: r, ok: true };
  }

  private recache(prev: CachedResult, args: any[] | undefined): CachedCall {
    const error = this.reenter(prev);
    const call: CachedCall = this.write();
    const c: CachedResult = call.cache;
    const mon: Monitor | null = prev.config.monitor;
    if (!error)
      c.enter(call.record, prev, mon);
    try
    {
      if (args)
        c.args = args;
      else
        args = c.args;
      if (!error)
        c.ret = CachedMethod.run<any>(c, (...argsx: any[]): any => {
          return c.config.body.call(this.handle.proxy, ...argsx);
        }, ...args);
      else
        c.ret = Promise.reject(error);
      c.outdated.timestamp = UNDEFINED_TIMESTAMP;
    }
    finally {
      if (!error)
        c.tryLeave(call.record, prev, mon);
    }
    return call;
  }

  private reenter(c: CachedResult): Error | undefined {
    let error: Error | undefined = undefined;
    const prev = c.outdated.recaching;
    const caller = Transaction.active;
    if (prev)
      switch (c.config.reentrant) {
        case ReentrantCall.ExitWithError:
          throw new Error(`${c.hint()} is configured as non-reentrant`);
        case ReentrantCall.WaitAndRestart:
          error = new Error(`transaction t${caller.id} (${caller.hint}) will be restarted after t${prev.tran.id} (${prev.tran.hint})`);
          caller.cancel(error, prev.tran);
          // TODO: "c.outdated.recaching = caller" in order serialize all the transactions
          break;
        case ReentrantCall.CancelPrevious:
          prev.tran.cancel();
          c.outdated.recaching = undefined;
          break;
        case ReentrantCall.RunSideBySide:
          break; // do nothing
      }
    return error;
  }

  private reconfigure(config: Partial<Config>): Config {
    const call = this.read(false);
    const c: CachedResult = call.cache;
    const r: Record = call.record;
    const hint: string = T.level > 2 ? `${Hint.handle(this.handle)}.${this.empty.member.toString()}/configure` : /* istanbul ignore next */ "configure";
    return Transaction.runAs<Config>(hint, SeparateFrom.Reaction, 0, (): Config => {
      const call2 = this.write();
      const c2: CachedResult = call2.cache;
      c2.config = new ConfigRecord(c2.config.body, c2.config, config, false);
      if (T.level >= 5) T.log("║", "w", `${Hint.record(r)}.${c.member.toString()}.config = ...`);
      return c2.config;
    });
  }

  static run<T>(c: CachedResult | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined;
    const outer = CachedResult.active;
    const outerVerbosity = T.level;
    const outerMargin = T.margin;
    try {
      CachedResult.active = c;
      if (c) {
        if (c.config.tracing !== 0)
          T.level = c.config.tracing;
        T.margin = c.margin;
      }
      result = func(...args);
    }
    catch (e) {
      if (c)
        c.error = e;
      throw e;
    }
    finally {
      T.margin = outerMargin;
      T.level = outerVerbosity;
      CachedResult.active = outer;
    }
    return result;
  }
}

// CacheResult

export class CachedResult implements ICachedResult {
  static active?: CachedResult = undefined;
  readonly margin: number;
  readonly tran: Transaction;
  readonly record: Record;
  readonly member: PropertyKey;
  config: ConfigRecord;
  args: any[];
  ret: any;
  result: any;
  error: any;
  started: number;
  readonly outdated: { timestamp: number, recaching: CachedResult | undefined };
  readonly observables: Map<PropertyKey, Set<Record>>;
  readonly hotObservables: Map<PropertyKey, Set<Record>>;

  constructor(record: Record, member: PropertyKey, init: CachedResult | ConfigRecord) {
    this.margin = T.margin + 1;
    this.tran = Transaction.active;
    this.record = record;
    this.member = member;
    if (init instanceof CachedResult) {
      this.config = init.config;
      this.args = init.args;
      this.result = init.result;
    }
    else { // init instanceof ConfigRecord
      this.config = init;
      this.args = [];
      this.result = undefined;
    }
    // this.ret = undefined;
    // this.error = undefined;
    this.started = 0;
    this.outdated = { timestamp: 0, recaching: undefined };
    this.observables = new Map<PropertyKey, Set<Record>>();
    this.hotObservables = new Map<PropertyKey, Set<Record>>();
  }

  hint(tranless?: boolean): string { return `${Hint.record(this.record, tranless, false, this.member)}`; }

  static get(method: F<any>): ReactiveCache<any> {
    const impl: ReactiveCache<any> | undefined = Utils.get(method, RT_CACHE);
    if (!impl)
      throw new Error("given method is not a reactronic cache");
    return impl;
  }

  wrap<T>(func: F<T>): F<T> {
    const caching: F<T> = (...args: any[]): T => CachedMethod.run<T>(this, func, ...args);
    return caching;
  }

  triggerRecache(timestamp: number, now: boolean): void {
    if (now || this.config.latency === Renew.Immediately) {
      if (!this.error && (this.config.latency === Renew.NoCache ||
          (timestamp >= this.outdated.timestamp && !this.outdated.recaching))) {
        const proxy: any = Utils.get(this.record.data, RT_HANDLE).proxy;
        const trap: Function = Reflect.get(proxy, this.member, proxy);
        const cachedMethod: CachedMethod = Utils.get(trap, RT_CACHE);
        const call: CachedCall = cachedMethod.call(true);
        if (call.cache.ret instanceof Promise)
          call.cache.ret.catch(error => { /* nop */ }); // bad idea to hide an error
      }
    }
    else
      sleep(this.config.latency).then(() => this.triggerRecache(timestamp, true));
  }

  static markViewed(r: Record, prop: PropertyKey): void {
    const c: CachedResult | undefined = CachedResult.active; // alias
    if (c && c.config.latency >= Renew.Manually && prop !== RT_HANDLE) {
      CachedResult.acquireObservableSet(c, prop, c.tran.id === r.snapshot.id).add(r);
      if (T.level >= 5) T.log("║", "r", `${c.hint(true)} uses ${Hint.record(r)}.${prop.toString()}`);
    }
  }

  static markChanged(r: Record, prop: PropertyKey, changed: boolean, value: any): void {
    changed ? r.changes.add(prop) : r.changes.delete(prop);
    if (T.level >= 5) T.log("║", "w", `${Hint.record(r, true)}.${prop.toString()} = ${Utils.valueHint(value)}`);
    const oo = r.observers.get(prop);
    if (oo && oo.size > 0) { // real-time notifications (inside the same transaction)
      const effect: ICachedResult[] = [];
      oo.forEach(c => c.markOutdated(r, prop, true, false, effect));
      r.observers.delete(prop);
      if (effect.length > 0)
        Transaction.triggerRecacheAll(Hint.record(r), r.snapshot.timestamp,
          { tran: Transaction.active, effect });
    }
  }

  static applyDependencies(changeset: Map<Handle, Record>, effect: ICachedResult[]): void {
    changeset.forEach((r: Record, h: Handle) => {
      if (!r.changes.has(RT_UNMOUNT))
        r.changes.forEach(prop => {
          CachedResult.markPrevAsOutdated(r, prop, effect);
          const value = r.data[prop];
          if (value instanceof CachedResult)
            value.subscribeToObservables(false, effect);
        });
      else
        for (const prop in r.prev.record.data)
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
    const o = hot ? c.hotObservables : c.observables;
    let result: Set<Record> | undefined = o.get(prop);
    if (!result)
      o.set(prop, result = new Set<Record>());
    return result;
  }

  private subscribeToObservables(hot: boolean, effect?: ICachedResult[]): void {
    const subscriptions: string[] = [];
    const o = hot ? this.hotObservables : this.observables;
    o.forEach((observables: Set<Record>, prop: PropertyKey) => {
      observables.forEach(r => {
        CachedResult.acquireObserverSet(r, prop).add(this); // link
        if (T.level >= 3) subscriptions.push(Hint.record(r, false, true, prop));
        if (effect && r.outdated.has(prop))
          this.markOutdated(r, prop, hot, false, effect);
      });
    });
    if (T.level >= 3 && subscriptions.length > 0) T.log(hot ? "║  " : " ", "O", `${Hint.record(this.record, false, false, this.member)} is subscribed to {${subscriptions.join(", ")}}.`);
  }

  isOutdated(): boolean { // TODO: should depend on caller context
    const ctx = Snapshot.active();
    return this.outdated.timestamp <= ctx.timestamp;
  }

  markOutdated(cause: Record, causeProp: PropertyKey, hot: boolean, cascade: boolean, effect: ICachedResult[]): void {
    const stamp = cause.snapshot.timestamp;
    if (this.outdated.timestamp === UNDEFINED_TIMESTAMP && (!cascade || this.config.latency !== Renew.WhenReady)) {
      this.outdated.timestamp = stamp;
      // TODO: make cache readonly
      // Cascade invalidation
      const upper: Record = Snapshot.active().read(Utils.get(this.record.data, RT_HANDLE));
      if (upper.data[this.member] === this) { // TODO: Consider better solution?
        let r: Record = upper;
        while (r !== Record.empty && !r.outdated.has(this.member)) {
          const oo = r.observers.get(this.member);
          if (oo)
            oo.forEach(c => c.markOutdated(upper, this.member, false, true, effect));
          r = r.prev.record;
        }
      }
      // Check if cache should be renewed
      if (this.config.latency >= Renew.Immediately && upper.data[RT_UNMOUNT] !== RT_UNMOUNT) {
        effect.push(this);
        if (T.level >= 2) T.log(" ", "■", `${this.hint(false)} is outdated by ${Hint.record(cause, false, false, causeProp)} and will run automatically`);
      }
      else
        if (T.level >= 2) T.log(" ", "□", `${this.hint(false)} is outdated by ${Hint.record(cause, false, false, causeProp)}`);
    }
  }

  static enforceMarkOutdated(c: CachedResult, cause: string, latency: number): boolean {
    throw new Error("not implemented - Cache.enforceMarkOutdated");
    // let effect: Cache[] = [];
    // c.markOutdated(cause, false, false, effect);
    // if (latency === Renew.Immediately)
    //   Transaction.ensureAllUpToDate(cause, { effect });
    // else
    //   sleep(latency).then(() => Transaction.ensureAllUpToDate(cause, { effect }));
    // return true;
  }

  static markPrevAsOutdated(r: Record, prop: PropertyKey, effect: ICachedResult[]): void {
    const cause = r;
    r = r.prev.record;
    while (r !== Record.empty && !r.outdated.has(prop)) {
      r.outdated.add(prop);
      const oo = r.observers.get(prop);
      if (oo)
        oo.forEach(c => c.markOutdated(cause, prop, false, false, effect));
      // Utils.freezeSet(o);
      r = r.prev.record;
    }
  }

  static createCachedMethodTrap(h: Handle, prop: PropertyKey, config: ConfigRecord): F<any> {
    const cachedMethod = new CachedMethod(h, prop, config);
    const cachedMethodTrap: F<any> = (...args: any[]): any =>
      cachedMethod.call(true, args).cache.ret;
    Utils.set(cachedMethodTrap, RT_CACHE, cachedMethod);
    return cachedMethodTrap;
  }

  enter(r: Record, prev: CachedResult, mon: Monitor | null): void {
    if (this.config.tracing >= 3 || (this.config.tracing === 0 && T.level >= 3)) T.log("║", "  ‾\\", `${Hint.record(r, true)}.${this.member.toString()} - enter`);
    this.started = Date.now();
    this.monitorEnter(mon);
    if (!prev.outdated.recaching)
      prev.outdated.recaching = this;
  }

  tryLeave(r: Record, prev: CachedResult, mon: Monitor | null): void {
    if (this.ret instanceof Promise) {
      this.ret = this.ret.then(
        result => {
          this.result = result;
          this.leave(r, prev, mon, "▒▒", "- finished ", "   OK ──┘");
          return result;
        },
        error => {
          this.error = error;
          this.leave(r, prev, mon, "▒▒", "- finished ", "ERROR ──┘");
          throw error;
        });
      if (this.config.tracing >= 3 || (this.config.tracing === 0 && T.level >= 3))
        T.log("║", "  _/", `${Hint.record(r, true)}.${this.member.toString()} - leave... `, 0, "ASYNC ──┐");
    }
    else {
      this.result = this.ret;
      this.leave(r, prev, mon, "_/", "- leave");
    }
  }

  private leave(r: Record, prev: CachedResult, mon: Monitor | null, op: string, message: string, highlight: string | undefined = undefined): void {
    if (prev.outdated.recaching === this)
      prev.outdated.recaching = undefined;
    this.monitorLeave(mon);
    const ms: number = Date.now() - this.started;
    this.started = 0;
    if (this.config.tracing >= 3 || (this.config.tracing === 0 && T.level >= 3)) T.log("║", `  ${op}`, `${Hint.record(r, true)}.${this.member.toString()} ${message}`, ms, highlight);
    // TODO: handle errors
    this.subscribeToObservables(true);
    this.hotObservables.clear();
    // Cache.freeze(this);
  }

  monitorEnter(mon: Monitor | null): void {
    if (mon)
      CachedMethod.run(undefined, Transaction.runAs, "Monitor.enter",
        mon.separate, 0, () => mon.enter(this));
  }

  monitorLeave(mon: Monitor | null): void {
    if (mon) {
      if (mon.prolonged) {
        const outer = Transaction.active;
        try {
          Transaction.active = Transaction.none; // Workaround?
          const leave = () => {
            CachedMethod.run(undefined, Transaction.runAs, "Monitor.leave",
              mon.separate, 0, () => mon.leave(this));
          };
          this.tran.whenFinished(false).then(leave, leave);
        }
        finally {
          Transaction.active = outer;
        }
      }
      else
      CachedMethod.run(undefined, Transaction.runAs, "Monitor.leave",
        mon.separate, 0, () => mon.leave(this));
    }
  }

  static differentImpl(oldValue: any, newValue: any): boolean {
    let result: boolean;
    if (oldValue instanceof CachedResult)
      result = !(newValue instanceof CachedResult);
    else
      result = !Utils.equal(oldValue, newValue);
    return result;
  }

  static freeze(c: CachedResult): void {
    // Utils.freezeMap(c.observables);
    // Utils.freezeSet(c.statusObservables);
    Object.freeze(c);
  }

  static unmount(...objects: any[]): Transaction {
    let t: Transaction = Transaction.active;
    Transaction.runAs<void>("unmount", SeparateFrom.Reaction, 0, (): void => {
      t = Transaction.active;
      for (const x of objects) {
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
  const t = Transaction.active;
  if (!t.isFinished()) {
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
  Record.markChanged = CachedResult.markChanged; // override
  Snapshot.applyDependencies = CachedResult.applyDependencies; // override
  Virt.createCachedMethodTrap = CachedResult.createCachedMethodTrap; // override
  Snapshot.active = Transaction._getActiveSnapshot; // override
  Transaction._init();
  // if (T.level >= 2) T.log("", "", "Reactronic is initialized", 0);
}

init();
