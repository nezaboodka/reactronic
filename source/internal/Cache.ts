// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Dbg, Utils, rethrow, Record, ICacheResult, F, Handle, Snapshot, Hint, ConfigRecord, Hooks, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from './all';
import { Status } from '../api/Status';
export { Status, resultof, statusof } from '../api/Status';
import { Config, Renew, RenewMs, Reentrance, Start, Trace } from '../api/Config';
import { Transaction } from '../api/Transaction';
import { Monitor } from '../api/Monitor';

const UNDEFINED_TIMESTAMP = Number.MAX_SAFE_INTEGER;
type CachedCall = { cache: CacheResult, record: Record, valid: boolean };

export class Cache extends Status<any> {
  private readonly handle: Handle;
  private readonly blank: CacheResult;

  get config(): Config { return this.read(false).cache.config; }
  configure(config: Partial<Config>): Config { return this.reconfigure(config); }
  get stamp(): number { return this.read(true).record.snapshot.timestamp; }
  get error(): boolean { return this.read(true).cache.error; }
  getResult(...args: any): any { return this.call(false, args).cache.result; }
  get isInvalid(): boolean { return this.read(true).cache.isInvalid; }
  invalidate(cause: string | undefined): boolean { return cause ? CacheResult.enforceInvalidation(this.read(false).cache, cause, 0) : false; }

  constructor(handle: Handle, member: PropertyKey, config: ConfigRecord) {
    super();
    this.handle = handle;
    this.blank = new CacheResult(Record.blank, member, config);
    CacheResult.freeze(this.blank);
    // TODO: mark cache readonly?
  }

  call(noprev: boolean, args?: any[]): CachedCall {
    let call: CachedCall = this.read(false, args);
    if (!call.valid) {
      const c: CacheResult = call.cache;
      const hint: string = Dbg.isOn && Dbg.trace.hints ? `${Hint.handle(this.handle)}.${c.member.toString()}${args && args.length > 0 ? `/${args[0]}` : ""}` : /* istanbul ignore next */ "renew";
      const start = noprev ? c.config.start : Start.AsStandaloneTransaction;
      let call2 = call;
      const ret = Transaction.runAs(hint, start, c.config.trace, (argsx: any[] | undefined): any => {
        // TODO: Cleaner implementation is needed
        if (call2.cache.tran.isCanceled()) {
          call2 = this.read(false, argsx); // re-read on retry
          if (!call2.valid)
            call2 = this.renew(call2.cache, argsx);
        }
        else
          call2 = this.renew(call2.cache, argsx);
        return call2.cache.ret;
      }, args);
      call2.cache.ret = ret;
      if (noprev)
        call = call2;
    }
    else
      if (Dbg.isOn && Dbg.trace.methods) Dbg.log(Transaction.current !== Transaction.none ? "║" : "", "  ==", `${Hint.record(call.record)}.${call.cache.member.toString()} is reused (cached by ${call.cache.tran.hint})`);
    Record.markViewed(call.record, call.cache.member);
    return call;
  }

  private read(markViewed: boolean, args?: any[]): CachedCall {
    const ctx = Snapshot.readable();
    const member = this.blank.member;
    const r: Record = ctx.tryRead(this.handle);
    const c: CacheResult = r.data[member] || this.blank;
    const valid = c.config.renew !== Renew.Off &&
      ctx.timestamp < c.invalid.since &&
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
    let c: CacheResult = r.data[member] || this.blank;
    if (c.record !== r) {
      const c2 = new CacheResult(r, c.member, c);
      r.data[c2.member] = c2;
      Record.markChanged(r, c2.member, true, c2);
      c = c2;
    }
    return { cache: c, record: r, valid: true };
  }

  private renew(prev: CacheResult, args: any[] | undefined): CachedCall {
    const error = this.reenter(prev);
    const call: CachedCall = this.write();
    const c: CacheResult = call.cache;
    if (!error) {
      const mon: Monitor | null = prev.config.monitor;
      c.enter(call.record, prev, mon);
      try
      {
        args ? c.args = args : args = c.args;
        c.ret = Cache.run<any>(c, (...argsx: any[]): any => {
          return c.config.body.call(this.handle.proxy, ...argsx);
        }, ...args);
        c.invalid.since = UNDEFINED_TIMESTAMP;
      }
      finally {
        c.tryLeave(call.record, prev, mon);
      }
    }
    else {
      c.ret = Promise.reject(error);
      c.invalid.since = UNDEFINED_TIMESTAMP;
    }
    return call;
  }

  private reenter(c: CacheResult): Error | undefined {
    let error: Error | undefined = undefined;
    const prev = c.invalid.renewing;
    const caller = Transaction.current;
    if (prev)
      switch (c.config.reentrance) {
        case Reentrance.PreventWithError:
          throw new Error(`${c.hint()} is configured as non-reentrant`);
        case Reentrance.WaitAndRestart:
          error = new Error(`transaction t${caller.id} (${caller.hint}) will be restarted after t${prev.tran.id} (${prev.tran.hint})`);
          caller.cancel(error, prev.tran);
          // TODO: "c.invalidation.recaching = caller" in order serialize all the transactions
          break;
        case Reentrance.CancelPrevious:
          prev.tran.cancel(new Error(`transaction t${prev.tran.id} (${prev.tran.hint}) is canceled by t${caller.id} (${caller.hint}) and will be silently ignored`), null);
          c.invalid.renewing = undefined;
          break;
        case Reentrance.RunSideBySide:
          break; // do nothing
      }
    return error;
  }

  private reconfigure(config: Partial<Config>): Config {
    const call = this.read(false);
    const c: CacheResult = call.cache;
    const r: Record = call.record;
    const hint: string = Dbg.isOn && Dbg.trace.hints ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : /* istanbul ignore next */ "configure";
    return Transaction.runAs(hint, Start.InsideParentTransaction, undefined, (): Config => {
      const call2 = this.write();
      const c2: CacheResult = call2.cache;
      c2.config = new ConfigRecord(c2.config.body, c2.config, config, false);
      if (Dbg.isOn && Dbg.trace.writes) Dbg.log("║", "  w ", `${Hint.record(r)}.${c.member.toString()}.config = ...`);
      return c2.config;
    });
  }

  static run<T>(c: CacheResult | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined;
    const outer = CacheResult.active;
    try {
      CacheResult.active = c;
      result = func(...args);
    }
    catch (e) {
      if (c)
        c.error = e;
      throw e;
    }
    finally {
      CacheResult.active = outer;
    }
    return result;
  }

  static createCacheTrap(h: Handle, prop: PropertyKey, config: ConfigRecord): F<any> {
    const cache = new Cache(h, prop, config);
    const cacheTrap: F<any> = (...args: any[]): any =>
      cache.call(true, args).cache.ret;
    Utils.set(cacheTrap, RT_CACHE, cache);
    return cacheTrap;
  }

  static get(method: F<any>): Status<any> {
    const impl: Status<any> | undefined = Utils.get(method, RT_CACHE);
    if (!impl)
      throw new Error("given method is not a reactronic cache");
    return impl;
  }

  static unmount(...objects: any[]): Transaction {
    return Transaction.runAs("unmount", Start.InsideParentTransaction, undefined,
      Cache.runUnmount, ...objects);
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

class CacheResult implements ICacheResult {
  static asyncRenewQueue: CacheResult[] = [];
  static active?: CacheResult = undefined;
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
  readonly invalid: { since: number, renewing: CacheResult | undefined };
  readonly observables: Map<PropertyKey, Set<Record>>;

  constructor(record: Record, member: PropertyKey, init: CacheResult | ConfigRecord) {
    this.margin = Dbg.isOn ? Dbg.trace.margin + 1 : 0;
    this.tran = Transaction.current;
    this.record = record;
    this.member = member;
    if (init instanceof CacheResult) {
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
    this.invalid = { since: 0, renewing: undefined };
    this.observables = new Map<PropertyKey, Set<Record>>();
  }

  hint(tranless?: boolean): string { return `${Hint.record(this.record, tranless, false, this.member)}`; }

  wrap<T>(func: F<T>): F<T> {
    const caching: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.methods && this.ret) Dbg.logAs(this, "║", "◦◦", `${Hint.record(this.record, true)}.${this.member.toString()} ‾\\         `, 0, "        │");
      const result = Cache.run<T>(this, func, ...args);
      if (Dbg.isOn && Dbg.trace.methods && this.ret) Dbg.logAs(this, "║", "◦◦", `${Hint.record(this.record, true)}.${this.member.toString()} _/         `, 0, "        │");
      return result;
    };
    return caching;
  }

  renew(timestamp: number, now: boolean, nothrow: boolean): void {
    if (now || this.config.renew === Renew.Immediately) {
      if (!this.error && (this.config.renew === Renew.Off ||
          (timestamp >= this.invalid.since && !this.invalid.renewing))) {
        try {
          const proxy: any = Utils.get(this.record.data, RT_HANDLE).proxy;
          const trap: Function = Reflect.get(proxy, this.member, proxy);
          const cache: Cache = Utils.get(trap, RT_CACHE);
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
    else if (this.config.renew === Renew.ImmediatelyAsync)
      CacheResult.enqueueAsyncRenew(this);
    else
      setTimeout(() => this.renew(UNDEFINED_TIMESTAMP, true, true), 0);
  }

  static enqueueAsyncRenew(c: CacheResult): void {
    CacheResult.asyncRenewQueue.push(c);
    if (CacheResult.asyncRenewQueue.length === 1)
      setTimeout(CacheResult.processAsyncRenewQueue, 0);
  }

  static processAsyncRenewQueue(): void {
    const batch = CacheResult.asyncRenewQueue;
    CacheResult.asyncRenewQueue = []; // reset
    for (const x of batch)
      x.renew(UNDEFINED_TIMESTAMP, true, true);
  }

  static markViewed(r: Record, prop: PropertyKey): void {
    const c: CacheResult | undefined = CacheResult.active; // alias
    if (c && c.config.renew >= Renew.Manually && prop !== RT_HANDLE) {
      CacheResult.acquireObservableSet(c, prop, c.tran.id === r.snapshot.id).add(r);
      if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", "  r ", `${c.hint(true)} uses ${Hint.record(r)}.${prop.toString()}`);
    }
  }

  static markChanged(r: Record, prop: PropertyKey, changed: boolean, value: any): void {
    changed ? r.changes.add(prop) : r.changes.delete(prop);
    if (Dbg.isOn && Dbg.trace.writes) Dbg.log("║", "  w ", `${Hint.record(r, true)}.${prop.toString()} = ${valueHint(value)}`);
  }

  static applyDependencies(snapshot: Snapshot, reactives: ICacheResult[]): void {
    snapshot.changeset.forEach((r: Record, h: Handle) => {
      if (!r.changes.has(RT_UNMOUNT))
        r.changes.forEach(prop => {
          CacheResult.markAllPrevRecordsAsOutdated(r, prop, reactives);
          const value = r.data[prop];
          if (value instanceof CacheResult)
            value.subscribeToObservables(reactives);
        });
      else
        for (const prop in r.prev.record.data)
          CacheResult.markAllPrevRecordsAsOutdated(r, prop, reactives);
    });
    snapshot.changeset.forEach((r: Record, h: Handle) => {
      Snapshot.mergeObservers(r, r.prev.record);
    });
  }

  static acquireObserverSet(r: Record, prop: PropertyKey): Set<ICacheResult> {
    let oo = r.observers.get(prop);
    if (!oo)
      r.observers.set(prop, oo = new Set<CacheResult>());
    return oo;
  }

  static acquireObservableSet(c: CacheResult, prop: PropertyKey, hot: boolean): Set<Record> {
    let result: Set<Record> | undefined = c.observables.get(prop);
    if (!result)
      c.observables.set(prop, result = new Set<Record>());
    return result;
  }

  private subscribeToObservables(reactives?: ICacheResult[]): void {
    const subscriptions: string[] = [];
    this.observables.forEach((observables: Set<Record>, prop: PropertyKey) => {
      observables.forEach(r => {
        CacheResult.acquireObserverSet(r, prop).add(this); // link
        if (Dbg.isOn && Dbg.trace.subscriptions) subscriptions.push(Hint.record(r, false, true, prop));
        if (reactives && r.outdated.has(prop))
          this.invalidate(r, prop, reactives);
      });
    });
    if ((Dbg.isOn && Dbg.trace.subscriptions || (this.config.trace && this.config.trace.subscriptions)) && subscriptions.length > 0) Dbg.logAs(this.config.trace, " ", "o", `${Hint.record(this.record, false, false, this.member)} is subscribed to {${subscriptions.join(", ")}}.`);
  }

  get isInvalid(): boolean { // TODO: should depend on caller context
    const ctx = Snapshot.readable();
    return this.invalid.since <= ctx.timestamp;
  }

  invalidate(cause: Record, causeProp: PropertyKey, reactives: ICacheResult[]): void {
    const stamp = cause.snapshot.timestamp;
    if (this.invalid.since === UNDEFINED_TIMESTAMP) {
      this.invalid.since = stamp;
      // Check if cache requires re-run
      const isReactive = this.config.renew >= Renew.Immediately && this.record.data[RT_UNMOUNT] !== RT_UNMOUNT;
      if (isReactive)
        reactives.push(this);
      if (Dbg.isOn && Dbg.trace.invalidations || (this.config.trace && this.config.trace.invalidations)) Dbg.logAs(this.config.trace, " ", isReactive ? "■" : "□", `${this.hint(false)} is invalidated by ${Hint.record(cause, false, false, causeProp)}${isReactive ? " and will run automatically" : ""}`);
      // Invalidate children (cascade)
      const h: Handle = Utils.get(this.record.data, RT_HANDLE);
      let r: Record = h.head;
      while (r !== Record.blank && !r.outdated.has(this.member)) {
        if (r.data[this.member] === this) {
          const oo = r.observers.get(this.member);
          if (oo)
            oo.forEach(c => c.invalidate(r, this.member, reactives));
        }
        r = r.prev.record;
      }
    }
  }

  static markAllPrevRecordsAsOutdated(cause: Record, prop: PropertyKey, reactives: ICacheResult[]): void {
    let r = cause.prev.record;
    while (r !== Record.blank && !r.outdated.has(prop)) {
      r.outdated.set(prop, cause);
      const oo = r.observers.get(prop);
      if (oo)
        oo.forEach(c => c.invalidate(cause, prop, reactives));
      // Utils.freezeSet(o);
      r = r.prev.record;
    }
  }

  static enforceInvalidation(c: CacheResult, cause: string, renew: RenewMs): boolean {
    throw new Error("not implemented - Cache.enforceInvalidation");
    // let reactives: Cache[] = [];
    // c.invalidate(cause, false, false, reactives);
    // if (autorun === Rerun.Immediately)
    //   Transaction.ensureAllUpToDate(cause, { reactives });
    // else
    //   sleep(autorun).then(() => Transaction.ensureAllUpToDate(cause, { reactives }));
    // return true;
  }

  enter(r: Record, prev: CacheResult, mon: Monitor | null): void {
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "  ‾\\", `${Hint.record(r, true)}.${this.member.toString()} - enter`);
    this.started = Date.now();
    this.monitorEnter(mon);
    if (!prev.invalid.renewing)
      prev.invalid.renewing = this;
  }

  tryLeave(r: Record, prev: CacheResult, mon: Monitor | null): void {
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
      if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "  _/", `${Hint.record(r, true)}.${this.member.toString()} - leave... `, 0, "ASYNC ──┐");
    }
    else {
      this.result = this.ret;
      this.leave(r, prev, mon, "_/", "- leave");
    }
  }

  private leave(r: Record, prev: CacheResult, mon: Monitor | null, op: string, message: string, highlight: string | undefined = undefined): void {
    if (prev.invalid.renewing === this)
      prev.invalid.renewing = undefined;
    this.monitorLeave(mon);
    const ms: number = Date.now() - this.started;
    this.started = 0;
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", `  ${op}`, `${Hint.record(r, true)}.${this.member.toString()} ${message}`, ms, highlight);
    // TODO: handle errors
    // Cache.freeze(this);
  }

  monitorEnter(mon: Monitor | null): void {
    if (mon)
      Cache.run(undefined, Transaction.runAs, "Monitor.enter",
        mon.start, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global,
        Monitor.enter, mon, this);
  }

  monitorLeave(mon: Monitor | null): void {
    if (mon) {
      if (mon.prolonged) {
        const outer = Transaction.current;
        try {
          Transaction._current = Transaction.none; // Workaround?
          const leave = () => {
            Cache.run(undefined, Transaction.runAs, "Monitor.leave",
              mon.start, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global,
              Monitor.leave, mon, this);
          };
          this.tran.whenFinished(false).then(leave, leave);
        }
        finally {
          Transaction._current = outer;
        }
      }
      else
        Cache.run(undefined, Transaction.runAs, "Monitor.leave",
          mon.start, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global,
          Monitor.leave, mon, this);
    }
  }

  static equal(oldValue: any, newValue: any): boolean {
    let result: boolean;
    if (oldValue instanceof CacheResult)
      result = oldValue.config.renew === Renew.Off;
    else
      result = oldValue === newValue;
    return result;
  }

  static freeze(c: CacheResult): void {
    // Utils.freezeMap(c.observables);
    // Utils.freezeSet(c.statusObservables);
    Object.freeze(c);
  }

  static currentTrace(local: Partial<Trace> | undefined): Trace {
    const t = Transaction.current;
    let res = Dbg.merge(t.trace, 31 + t.id % 6, `t${t.id}`, Dbg.global);
    if (CacheResult.active)
      res = Dbg.merge(CacheResult.active, undefined, undefined, res);
    if (local)
      res = Dbg.merge(local, undefined, undefined, res);
    return res;
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
  else if (value instanceof CacheResult)
    result = `<renew:${Hint.record(value.record.prev.record, false, true)}>`;
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
      onsuccess = Transaction._wrap<any>(t, CacheResult.active, true, true, onsuccess);
      onfailure = Transaction._wrap<any>(t, CacheResult.active, false, true, onfailure || rethrow);
    }
    else if (onfailure)
      onfailure = Transaction._wrap<any>(t, CacheResult.active, false, false, onfailure);
  }
  return original_primise_then.call(this, onsuccess, onfailure);
}

// Global Init

function init(): void {
  Dbg.getCurrentTrace = CacheResult.currentTrace;
  Record.markViewed = CacheResult.markViewed; // override
  Record.markChanged = CacheResult.markChanged; // override
  Snapshot.equal = CacheResult.equal; // override
  Snapshot.applyDependencies = CacheResult.applyDependencies; // override
  Hooks.createCacheTrap = Cache.createCacheTrap; // override
  Promise.prototype.then = promiseThenProxy; // override
}

init();
