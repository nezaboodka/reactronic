// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.

// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Utils, Dbg, rethrow, Record, ICachedResult, F, Handle, Snapshot, Hint, ConfigRecord, Hooks, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from './z.index';
import { Cache } from '../Cache';
export { Cache, resultof, cacheof } from '../Cache';
import { Config, Renew, Renewal, ReentrantCalls, SeparatedFrom } from '../Config';
import { Transaction } from '../Transaction';
import { Monitor } from '../Monitor';

const UNDEFINED_TIMESTAMP = Number.MAX_SAFE_INTEGER;
type CachedCall = { cache: CachedResult, record: Record, valid: boolean };

export class MethodCache extends Cache<any> {
  private readonly handle: Handle;
  private readonly blank: CachedResult;

  get config(): Config { return this.read(false).cache.config; }
  configure(config: Partial<Config>): Config { return this.reconfigure(config); }
  get stamp(): number { return this.read(true).record.snapshot.timestamp; }
  get error(): boolean { return this.read(true).cache.error; }
  getResult(...args: any): any { return this.call(false, args).cache.result; }
  get isInvalid(): boolean { return this.read(true).cache.isInvalid; }
  invalidate(cause: string | undefined): boolean { return cause ? CachedResult.enforceInvalidation(this.read(false).cache, cause, 0) : false; }

  constructor(handle: Handle, member: PropertyKey, config: ConfigRecord) {
    super();
    this.handle = handle;
    this.blank = new CachedResult(Record.blank, member, config);
    CachedResult.freeze(this.blank);
    // TODO: mark cache readonly?
  }

  call(recache: boolean, args?: any[]): CachedCall {
    let call: CachedCall = this.read(false, args);
    if (!call.valid) {
      const c: CachedResult = call.cache;
      const hint: string = Dbg.trace.hints ? `${Hint.handle(this.handle)}.${c.member.toString()}${args && args.length > 0 ? `/${args[0]}` : ""}` : /* istanbul ignore next */ "recache";
      const separated = recache ? c.config.separated : (c.config.separated | SeparatedFrom.Parent);
      let call2 = call;
      const ret = Transaction.runAs(hint, separated, c.config.trace, (argsx: any[] | undefined): any => {
        // TODO: Cleaner implementation is needed
        if (call2.cache.tran.isCanceled()) {
          call2 = this.read(false, argsx); // re-read on retry
          if (!call2.valid)
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
      if (Dbg.trace.methods) Dbg.log(Transaction.current !== Transaction.none ? "║" : "", "  ==", `${Hint.record(call.record)}.${call.cache.member.toString()} is reused (cached by ${call.cache.tran.hint})`);
    Record.markViewed(call.record, call.cache.member);
    return call;
  }

  private read(markViewed: boolean, args?: any[]): CachedCall {
    const ctx = Snapshot.readable();
    const member = this.blank.member;
    const r: Record = ctx.tryRead(this.handle);
    const c: CachedResult = r.data[member] || this.blank;
    const valid = c.config.renewal !== Renew.NoCache &&
      ctx.timestamp < c.invalidation.timestamp &&
      (args === undefined || c.args[0] === args[0]) ||
      r.data[RT_UNMOUNT] === RT_UNMOUNT;
    if (markViewed)
      Record.markViewed(r, c.member);
    return { cache: c, record: r, valid };
  }

  private write(): CachedCall {
    const ctx = Snapshot.writable();
    const member = this.blank.member;
    const r: Record = ctx.write(this.handle, member, RT_CACHE);
    let c: CachedResult = r.data[member] || this.blank;
    if (c.record !== r) {
      const c2 = new CachedResult(r, c.member, c);
      r.data[c2.member] = c2;
      Record.markChanged(r, c2.member, true, c2);
      c = c2;
    }
    return { cache: c, record: r, valid: true };
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
        c.ret = MethodCache.run<any>(c, (...argsx: any[]): any => {
          return c.config.body.call(this.handle.proxy, ...argsx);
        }, ...args);
      else
        c.ret = Promise.reject(error);
      c.invalidation.timestamp = UNDEFINED_TIMESTAMP;
    }
    finally {
      if (!error)
        c.tryLeave(call.record, prev, mon);
    }
    return call;
  }

  private reenter(c: CachedResult): Error | undefined {
    let error: Error | undefined = undefined;
    const prev = c.invalidation.recaching;
    const caller = Transaction.current;
    if (prev)
      switch (c.config.reentrant) {
        case ReentrantCalls.ExitWithError:
          throw new Error(`${c.hint()} is configured as non-reentrant`);
        case ReentrantCalls.WaitAndRestart:
          error = new Error(`transaction t${caller.id} (${caller.hint}) will be restarted after t${prev.tran.id} (${prev.tran.hint})`);
          caller.cancel(error, prev.tran);
          // TODO: "c.invalidation.recaching = caller" in order serialize all the transactions
          break;
        case ReentrantCalls.CancelPrevious:
          prev.tran.cancel(new Error(`transaction t${prev.tran.id} (${prev.tran.hint}) is canceled by t${caller.id} (${caller.hint}) and will be silently ignored`), null);
          c.invalidation.recaching = undefined;
          break;
        case ReentrantCalls.RunSideBySide:
          break; // do nothing
      }
    return error;
  }

  private reconfigure(config: Partial<Config>): Config {
    const call = this.read(false);
    const c: CachedResult = call.cache;
    const r: Record = call.record;
    const hint: string = Dbg.trace.hints ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : /* istanbul ignore next */ "configure";
    return Transaction.runAs(hint, SeparatedFrom.Reaction, undefined, (): Config => {
      const call2 = this.write();
      const c2: CachedResult = call2.cache;
      c2.config = new ConfigRecord(c2.config.body, c2.config, config, false);
      if (Dbg.trace.writes) Dbg.log("║", "  w ", `${Hint.record(r)}.${c.member.toString()}.config = ...`);
      return c2.config;
    });
  }

  static run<T>(c: CachedResult | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined;
    const outer = CachedResult.active;
    const restore = Dbg.trace.methods
      ? (this.trace === undefined || this.trace.methods !== false
        ? Dbg.push(this.trace, c)
        : Dbg.trace)
      : (this.trace !== undefined && this.trace.methods === true
        ? Dbg.push(this.trace, c)
        : Dbg.trace);
    try {
      CachedResult.active = c;
      result = func(...args);
    }
    catch (e) {
      if (c)
        c.error = e;
      throw e;
    }
    finally {
      CachedResult.active = outer;
      Dbg.trace = restore;
    }
    return result;
  }

  static createMethodCacheTrap(h: Handle, prop: PropertyKey, config: ConfigRecord): F<any> {
    const cache = new MethodCache(h, prop, config);
    const methodCacheTrap: F<any> = (...args: any[]): any =>
      cache.call(true, args).cache.ret;
    Utils.set(methodCacheTrap, RT_CACHE, cache);
    return methodCacheTrap;
  }

  static get(method: F<any>): Cache<any> {
    const impl: Cache<any> | undefined = Utils.get(method, RT_CACHE);
    if (!impl)
      throw new Error("given method is not a reactronic cache");
    return impl;
  }

  static unmount(...objects: any[]): Transaction {
    return Transaction.runAs("unmount", SeparatedFrom.Reaction, undefined,
      MethodCache.runUnmount, ...objects);
  }

  private static runUnmount(...objects: any[]): Transaction {
    for (const x of objects) {
      if (Utils.get(x, RT_HANDLE))
        x[RT_UNMOUNT] = RT_UNMOUNT;
    }
    return Transaction.current;
  }
}

// CacheResult

class CachedResult implements ICachedResult {
  static asyncRecacheQueue: CachedResult[] = [];
  static active?: CachedResult = undefined;
  get color(): number { return Dbg.trace.color; }
  get prefix(): string { return Dbg.trace.prefix; }
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
  readonly invalidation: { timestamp: number, recaching: CachedResult | undefined };
  readonly observables: Map<PropertyKey, Set<Record>>;

  constructor(record: Record, member: PropertyKey, init: CachedResult | ConfigRecord) {
    this.margin = Dbg.trace.margin + 1;
    this.tran = Transaction.current;
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
    this.invalidation = { timestamp: 0, recaching: undefined };
    this.observables = new Map<PropertyKey, Set<Record>>();
  }

  hint(tranless?: boolean): string { return `${Hint.record(this.record, tranless, false, this.member)}`; }

  wrap<T>(func: F<T>): F<T> {
    const caching: F<T> = (...args: any[]): T => MethodCache.run<T>(this, func, ...args);
    return caching;
  }

  triggerRecache(timestamp: number, now: boolean, nothrow: boolean): void {
    if (now || this.config.renewal === Renew.Immediately) {
      if (!this.error && (this.config.renewal === Renew.NoCache ||
          (timestamp >= this.invalidation.timestamp && !this.invalidation.recaching))) {
        try {
          const proxy: any = Utils.get(this.record.data, RT_HANDLE).proxy;
          const trap: Function = Reflect.get(proxy, this.member, proxy);
          const cache: MethodCache = Utils.get(trap, RT_CACHE);
          const call: CachedCall = cache.call(true);
          if (call.cache.ret instanceof Promise)
            call.cache.ret.catch(error => { /* nop */ }); // bad idea to hide an error
        }
        catch (e) {
          if (!nothrow)
            throw e;
        }
      }
    }
    else if (this.config.renewal === Renew.ImmediatelyAsync)
      CachedResult.enqueueAsyncRecache(this);
    else
      setTimeout(() => this.triggerRecache(UNDEFINED_TIMESTAMP, true, true), 0);
  }

  static enqueueAsyncRecache(c: CachedResult): void {
    CachedResult.asyncRecacheQueue.push(c);
    if (CachedResult.asyncRecacheQueue.length === 1)
      setTimeout(CachedResult.handleAsyncRecacheQueue, 0);
  }

  static handleAsyncRecacheQueue(): void {
    const batch = CachedResult.asyncRecacheQueue;
    CachedResult.asyncRecacheQueue = []; // reset
    for (const x of batch)
      x.triggerRecache(UNDEFINED_TIMESTAMP, true, true);
  }

  static markViewed(r: Record, prop: PropertyKey): void {
    const c: CachedResult | undefined = CachedResult.active; // alias
    if (c && c.config.renewal >= Renew.Manually && prop !== RT_HANDLE) {
      CachedResult.acquireObservableSet(c, prop, c.tran.id === r.snapshot.id).add(r);
      if (Dbg.trace.reads) Dbg.log("║", "  r ", `${c.hint(true)} uses ${Hint.record(r)}.${prop.toString()}`);
    }
  }

  static markChanged(r: Record, prop: PropertyKey, changed: boolean, value: any): void {
    changed ? r.changes.add(prop) : r.changes.delete(prop);
    if (Dbg.trace.writes) Dbg.log("║", "  w ", `${Hint.record(r, true)}.${prop.toString()} = ${valueHint(value)}`);
  }

  static applyDependencies(snapshot: Snapshot, effect: ICachedResult[]): void {
    snapshot.changeset.forEach((r: Record, h: Handle) => {
      if (!r.changes.has(RT_UNMOUNT))
        r.changes.forEach(prop => {
          CachedResult.markAllPrevRecordsAsOutdated(r, prop, effect);
          const value = r.data[prop];
          if (value instanceof CachedResult)
            value.subscribeToObservables(effect);
        });
      else
        for (const prop in r.prev.record.data)
          CachedResult.markAllPrevRecordsAsOutdated(r, prop, effect);
    });
    snapshot.changeset.forEach((r: Record, h: Handle) => {
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
    let result: Set<Record> | undefined = c.observables.get(prop);
    if (!result)
      c.observables.set(prop, result = new Set<Record>());
    return result;
  }

  private subscribeToObservables(effect?: ICachedResult[]): void {
    const subscriptions: string[] = [];
    this.observables.forEach((observables: Set<Record>, prop: PropertyKey) => {
      observables.forEach(r => {
        CachedResult.acquireObserverSet(r, prop).add(this); // link
        if (Dbg.trace.subscriptions) subscriptions.push(Hint.record(r, false, true, prop));
        if (effect && r.outdated.has(prop))
          this.invalidate(r, prop, effect);
      });
    });
    if ((Dbg.trace.subscriptions || (this.config.trace && this.config.trace.subscriptions)) && subscriptions.length > 0) Dbg.logAs(this.config.trace, Transaction.current.pretty, " ", "o", `${Hint.record(this.record, false, false, this.member)} is subscribed to {${subscriptions.join(", ")}}.`);
  }

  get isInvalid(): boolean { // TODO: should depend on caller context
    const ctx = Snapshot.readable();
    return this.invalidation.timestamp <= ctx.timestamp;
  }

  invalidate(cause: Record, causeProp: PropertyKey, effect: ICachedResult[]): void {
    const stamp = cause.snapshot.timestamp;
    if (this.invalidation.timestamp === UNDEFINED_TIMESTAMP) {
      this.invalidation.timestamp = stamp;
      // Check if cache should be renewed
      const isEffect = this.config.renewal >= Renew.Immediately && this.record.data[RT_UNMOUNT] !== RT_UNMOUNT;
      if (isEffect)
        effect.push(this);
      if (Dbg.trace.invalidations || (this.config.trace && this.config.trace.invalidations)) Dbg.logAs(this.config.trace, Transaction.current.pretty, " ", isEffect ? "■" : "□", `${this.hint(false)} is invalidated by ${Hint.record(cause, false, false, causeProp)}${isEffect ? " and will run automatically" : ""}`);
      // Invalidate children (cascade)
      const h: Handle = Utils.get(this.record.data, RT_HANDLE);
      let r: Record = h.head;
      while (r !== Record.blank && !r.outdated.has(this.member)) {
        if (r.data[this.member] === this) {
          const oo = r.observers.get(this.member);
          if (oo)
            oo.forEach(c => c.invalidate(r, this.member, effect));
        }
        r = r.prev.record;
      }
    }
  }

  static markAllPrevRecordsAsOutdated(cause: Record, prop: PropertyKey, effect: ICachedResult[]): void {
    let r = cause.prev.record;
    while (r !== Record.blank && !r.outdated.has(prop)) {
      r.outdated.set(prop, cause);
      const oo = r.observers.get(prop);
      if (oo)
        oo.forEach(c => c.invalidate(cause, prop, effect));
      // Utils.freezeSet(o);
      r = r.prev.record;
    }
  }

  static enforceInvalidation(c: CachedResult, cause: string, renewal: Renewal): boolean {
    throw new Error("not implemented - Cache.enforceInvalidation");
    // let effect: Cache[] = [];
    // c.invalidate(cause, false, false, effect);
    // if (renewal === Renew.Immediately)
    //   Transaction.ensureAllUpToDate(cause, { effect });
    // else
    //   sleep(renewal).then(() => Transaction.ensureAllUpToDate(cause, { effect }));
    // return true;
  }

  enter(r: Record, prev: CachedResult, mon: Monitor | null): void {
    if (Dbg.trace.methods) Dbg.log("║", "  ‾\\", `${Hint.record(r, true)}.${this.member.toString()} - enter`);
    this.started = Date.now();
    this.monitorEnter(mon);
    if (!prev.invalidation.recaching)
      prev.invalidation.recaching = this;
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
      if (Dbg.trace.methods) Dbg.log("║", "  _/", `${Hint.record(r, true)}.${this.member.toString()} - leave... `, 0, "ASYNC ──┐");
    }
    else {
      this.result = this.ret;
      this.leave(r, prev, mon, "_/", "- leave");
    }
  }

  private leave(r: Record, prev: CachedResult, mon: Monitor | null, op: string, message: string, highlight: string | undefined = undefined): void {
    if (prev.invalidation.recaching === this)
      prev.invalidation.recaching = undefined;
    this.monitorLeave(mon);
    const ms: number = Date.now() - this.started;
    this.started = 0;
    if (Dbg.trace.methods) Dbg.log("║", `  ${op}`, `${Hint.record(r, true)}.${this.member.toString()} ${message}`, ms, highlight);
    // TODO: handle errors
    // Cache.freeze(this);
  }

  monitorEnter(mon: Monitor | null): void {
    if (mon)
      MethodCache.run(undefined, Transaction.runAs, "Monitor.enter",
        mon.separated, Dbg.trace.monitors ? undefined : Dbg.off,
        Monitor.enter, mon, this);
  }

  monitorLeave(mon: Monitor | null): void {
    if (mon) {
      if (mon.prolonged) {
        const outer = Transaction.current;
        try {
          Transaction._current = Transaction.none; // Workaround?
          const leave = () => {
            MethodCache.run(undefined, Transaction.runAs, "Monitor.leave",
              mon.separated, Dbg.trace.monitors ? undefined : Dbg.off,
              Monitor.leave, mon, this);
          };
          this.tran.whenFinished(false).then(leave, leave);
        }
        finally {
          Transaction._current = outer;
        }
      }
      else
        MethodCache.run(undefined, Transaction.runAs, "Monitor.leave",
          mon.separated, Dbg.trace.monitors ? undefined : Dbg.off,
          Monitor.leave, mon, this);
    }
  }

  static equal(oldValue: any, newValue: any): boolean {
    let result: boolean;
    if (oldValue instanceof CachedResult)
      result = oldValue.config.renewal === Renew.NoCache;
    else
      result = oldValue === newValue;
    return result;
  }

  static freeze(c: CachedResult): void {
    // Utils.freezeMap(c.observables);
    // Utils.freezeSet(c.statusObservables);
    Object.freeze(c);
  }
}

function valueHint(value: any): string {
  let result: string = "";
  if (Array.isArray(value))
    result = `Array(${value.length})`;
  else if (value instanceof Set)
    result = `Set(${value.size})`;
  else if (value instanceof Map)
    result = `Map(${value.size})`;
  else if (value instanceof CachedResult)
    result = `<recache:${Hint.record(value.record.prev.record, false, true)}>`;
  else if (value === RT_UNMOUNT)
    result = "<unmount>";
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 20);
  else
    result = "◌";
  return result;
}

const original_primise_then = Promise.prototype.then;

function promiseThenProxy(
  this: any, onsuccess?: ((value: any) => any | PromiseLike<any>) | undefined | null,
  onfailure?: ((reason: any) => never | PromiseLike<never>) | undefined | null): Promise<any | never>
{
  const t = Transaction.current;
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
}

// Global Init

function init(): void {
  Record.markViewed = CachedResult.markViewed; // override
  Record.markChanged = CachedResult.markChanged; // override
  Snapshot.equal = CachedResult.equal; // override
  Snapshot.applyDependencies = CachedResult.applyDependencies; // override
  Hooks.createMethodCacheTrap = MethodCache.createMethodCacheTrap; // override
  Promise.prototype.then = promiseThenProxy; // override
}

init();
