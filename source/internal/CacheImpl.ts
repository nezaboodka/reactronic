// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg, misuse, Utils, Record, ICacheResult, F, Handle, Snapshot, Hint, Cfg, Hooks, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from './all';
import { Cache } from '../api/Cache';
export { Cache, cacheof, resolved } from '../api/Cache';
import { Config, Kind, Reentrance, Trace } from '../api/Config';
import { Transaction } from '../api/Transaction';
import { Monitor } from '../api/Monitor';

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER;
type CacheCall = { valid: boolean, cache: CacheResult, record: Record };

export class CacheImpl extends Cache<any> {
  static get triggersAutoStartDisabled(): boolean { return Hooks.triggersAutoStartDisabled; }
  static set triggersAutoStartDisabled(value: boolean) { Hooks.triggersAutoStartDisabled = true; }
  private readonly handle: Handle;
  private readonly blank: CacheResult;

  configure(config: Partial<Config>): Config { return this.reconfigure(config); }
  get config(): Config { return this.weak().cache.config; }
  get stamp(): number { return this.weak().record.snapshot.timestamp; }
  get args(): ReadonlyArray<any> { return this.weak().cache.args; }
  get value(): any { return this._call(true).cache.value; }
  get error(): boolean { return this.weak().cache.error; }
  get isInvalid(): boolean { return !this.weak().valid; }
  invalidate(): void { CacheImpl.invalidate(this); }
  call(args?: any): any { return this._call(true, args).cache.value; }

  constructor(handle: Handle, member: PropertyKey, config: Cfg) {
    super();
    this.handle = handle;
    this.blank = new CacheResult(Record.blank, member, config);
    CacheResult.freeze(this.blank);
    // TODO: mark cache readonly?
  }

  _call(weak: boolean, args?: any[]): CacheCall {
    let call: CacheCall = this.readable(args);
    const c: CacheResult = call.cache;
    if (!call.valid && (!weak || !c.invalid.renewing)) {
      const hint: string = Dbg.isOn && Dbg.trace.hints ? `${Hint.handle(this.handle)}.${c.member.toString()}${args && args.length > 0 && args[0] instanceof Function === false ? `/${args[0]}` : ""}` : /* istanbul ignore next */ "Cache.run";
      const cfg = c.config;
      const spawn = weak || cfg.kind !== Kind.Transaction;
      const token = cfg.kind === Kind.Cached ? this : undefined;
      let call2 = call;
      const ret = Transaction.runAs(hint, spawn, cfg.trace, token, (argsx: any[] | undefined): any => {
        // TODO: Cleaner implementation is needed
        if (call2.cache.tran.isCanceled()) {
          call2 = this.readable(argsx); // re-read on retry
          if (!call2.valid) {
            call2 = this.writable();
            call2.cache.compute(this.handle.proxy, argsx);
          }
        }
        else {
          call2 = this.writable();
          call2.cache.compute(this.handle.proxy, argsx);
        }
        return call2.cache.ret;
      }, args);
      call2.cache.ret = ret;
      // TODO: Get rid of noprev
      if (!weak && Snapshot.readable().timestamp >= call2.cache.record.snapshot.timestamp)
        call = call2;
    }
    else
      if (Dbg.isOn && Dbg.trace.methods && (c.config.trace === undefined || c.config.trace.methods === undefined || c.config.trace.methods === true)) Dbg.log(Transaction.current !== Transaction.none ? "║" : "", "  ==", `${Hint.record(call.record)}.${call.cache.member.toString()} is reused (cached by T${call.cache.tran.id} ${call.cache.tran.hint})`);
    Record.markViewed(call.record, call.cache.member, weak);
    return call;
  }

  private weak(): CacheCall {
    const call = this.readable(undefined);
    Record.markViewed(call.record, call.cache.member, true);
    return call;
  }

  private readable(args?: any[]): CacheCall {
    const ctx = Snapshot.readable();
    const r: Record = ctx.tryRead(this.handle);
    const c: CacheResult = r.data[this.blank.member] || this.blank;
    const valid = c.config.kind !== Kind.Transaction &&
      (ctx === c.record.snapshot || ctx.timestamp < c.invalid.since) &&
      (args === undefined || c.args[0] === args[0]) ||
      r.data[RT_UNMOUNT] === RT_UNMOUNT;
    return { valid, cache: c, record: r };
  }

  private writable(): CacheCall {
    const ctx = Snapshot.writable();
    const member = this.blank.member;
    const r: Record = ctx.writable(this.handle, member, this);
    let c: CacheResult = r.data[member] || this.blank;
    if (c.record !== r) {
      const renewing = new CacheResult(r, member, c);
      r.data[member] = renewing;
      Record.markChanged(r, member, true, renewing);
      renewing.error = CacheImpl.checkForReentrance(c);
      if (!renewing.error)
        c.invalid.renewing = renewing;
      c = renewing;
    }
    return { valid: true, cache: c, record: r };
  }

  private static checkForReentrance(c: CacheResult): Error | undefined {
    let result: Error | undefined = undefined;
    const prev = c.invalid.renewing;
    const caller = Transaction.current;
    if (prev && prev !== c)
      switch (c.config.reentrance) {
        case Reentrance.PreventWithError:
          throw misuse(`${c.hint()} is configured as non-reentrant`);
        case Reentrance.WaitAndRestart:
          result = new Error(`transaction T${caller.id} (${caller.hint}) will be restarted after T${prev.tran.id} (${prev.tran.hint})`);
          caller.cancel(result, prev.tran);
          // TODO: "c.invalidation.recaching = caller" in order serialize all the transactions
          break;
        case Reentrance.CancelPrevious:
          prev.tran.cancel(new Error(`transaction T${prev.tran.id} (${prev.tran.hint}) is canceled by T${caller.id} (${caller.hint}) and will be silently ignored`), null);
          c.invalid.renewing = undefined; // allow
          break;
        case Reentrance.RunSideBySide:
          break; // do nothing
      }
    return result;
  }

  static invalidate(self: CacheImpl): void {
    const call = self.writable();
    const c = call.cache;
    CacheResult.acquireObservableSet(c, c.member, false).add(call.record);
    // if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", "  r ", `${c.hint(true)} uses ${Hint.record(r, prop)}`);
  }

  private reconfigure(config: Partial<Config>): Config {
    const call = this.readable();
    const c: CacheResult = call.cache;
    const r: Record = call.record;
    const hint: string = Dbg.isOn && Dbg.trace.hints ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : /* istanbul ignore next */ "configure";
    return Transaction.runAs(hint, false, undefined, undefined, (): Config => {
      const call2 = this.writable();
      const c2: CacheResult = call2.cache;
      c2.config = new Cfg(c2.config.body, c2.config, config, false);
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

  static createCacheTrap(h: Handle, prop: PropertyKey, config: Cfg): F<any> {
    const cache = new CacheImpl(h, prop, config);
    const cacheTrap: F<any> = (...args: any[]): any =>
      cache._call(false, args).cache.ret;
    Utils.set(cacheTrap, RT_CACHE, cache);
    return cacheTrap;
  }

  static get(method: F<any>): Cache<any> {
    const impl: Cache<any> | undefined = Utils.get(method, RT_CACHE);
    if (!impl)
      throw misuse("given method is not a reactronic cache");
    return impl;
  }

  static unmount(...objects: any[]): Transaction {
    return Transaction.runAs("<unmount>", false,
      undefined, undefined, CacheImpl.unmountFunc, ...objects);
  }

  private static unmountFunc(...objects: any[]): Transaction {
    for (const x of objects) {
      if (Utils.get(x, RT_HANDLE))
        x[RT_UNMOUNT] = RT_UNMOUNT;
    }
    return Transaction.current;
  }
}

// CacheResult

class CacheResult implements ICacheResult {
  static asyncTriggerBatch: CacheResult[] = [];
  static active?: CacheResult = undefined;

  readonly tran: Transaction;
  readonly record: Record;
  readonly member: PropertyKey;
  config: Cfg;
  args: any[];
  ret: any;
  value: any;
  error: any;
  started: number;
  readonly invalid: { since: number, renewing: CacheResult | undefined };
  readonly observables: Map<PropertyKey, Set<Record>>;
  readonly weakObservables: Map<PropertyKey, Set<Record>>;
  readonly margin: number;

  constructor(record: Record, member: PropertyKey, init: CacheResult | Cfg) {
    this.tran = Transaction.current;
    this.record = record;
    this.member = member;
    if (init instanceof CacheResult) {
      this.config = init.config;
      this.args = init.args;
      // this.value = init.value;
    }
    else { // init instanceof Config
      this.config = init;
      this.args = [];
      // this.value = undefined;
    }
    // this.ret = undefined;
    // this.error = undefined;
    this.started = 0;
    this.invalid = { since: 0, renewing: undefined };
    this.observables = new Map<PropertyKey, Set<Record>>();
    this.weakObservables = new Map<PropertyKey, Set<Record>>();
    this.margin = CacheResult.active ? CacheResult.active.margin + 1 : 1;
  }

  hint(): string { return `${Hint.record(this.record, this.member)}`; }

  bind<T>(func: F<T>): F<T> {
    const Cache_run: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, "║", "‾\\", `${Hint.record(this.record)}.${this.member.toString()} - step in  `, 0, "        │");
      const result = CacheImpl.run<T>(this, func, ...args);
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, "║", "_/", `${Hint.record(this.record)}.${this.member.toString()} - step out `, 0, this.started > 0 ? "        │" : "");
      return result;
    };
    return Cache_run;
  }

  renew(timestamp: number, now: boolean, nothrow: boolean): void {
    const latency = this.config.latency;
    if (now || latency === -1) {
      if (!this.error && (this.config.kind === Kind.Transaction ||
          (timestamp >= this.invalid.since && !this.invalid.renewing))) {
        try {
          const proxy: any = Utils.get(this.record.data, RT_HANDLE).proxy;
          const trap: Function = Reflect.get(proxy, this.member, proxy);
          const cache: CacheImpl = Utils.get(trap, RT_CACHE);
          const call: CacheCall = cache._call(false);
          if (call.cache.ret instanceof Promise)
            call.cache.ret.catch(error => { /* nop */ }); // bad idea to hide an error
        }
        catch (e) {
          if (!nothrow)
            throw e;
        }
      }
    }
    else if (latency === 0)
      CacheResult.addAsyncTriggerToBatch(this);
    else
      setTimeout(() => this.renew(TOP_TIMESTAMP, true, true), latency);
  }

  static addAsyncTriggerToBatch(c: CacheResult): void {
    CacheResult.asyncTriggerBatch.push(c);
    if (CacheResult.asyncTriggerBatch.length === 1)
      setTimeout(CacheResult.processAsyncTriggerBatch, 0);
  }

  static processAsyncTriggerBatch(): void {
    const triggers = CacheResult.asyncTriggerBatch;
    CacheResult.asyncTriggerBatch = []; // reset
    for (const t of triggers)
      t.renew(TOP_TIMESTAMP, true, true);
  }

  static markViewed(r: Record, prop: PropertyKey, weak: boolean): void {
    const c: CacheResult | undefined = CacheResult.active; // alias
    if (c && c.config.kind !== Kind.Transaction && prop !== RT_HANDLE) {
      Snapshot.readable().bumpReadStamp(r);
      CacheResult.acquireObservableSet(c, prop, weak).add(r);
      if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", `  ${weak ? 's' : 'r'} `, `${c.hint()} ${weak ? 'weakly uses' : 'uses'} ${Hint.record(r, prop)}`);
    }
  }

  static markChanged(r: Record, prop: PropertyKey, changed: boolean, value: any): void {
    changed ? r.changes.add(prop) : r.changes.delete(prop);
    if (Dbg.isOn && Dbg.trace.writes) Dbg.log("║", "  w ", `${Hint.record(r, prop)} = ${valueHint(value)}`);
  }

  static applyDependencies(snapshot: Snapshot, error?: any): void {
    if (error === undefined) {
      const triggers = snapshot.triggers;
      const timestamp = snapshot.timestamp;
      const readstamp = snapshot.readstamp;
      snapshot.changeset.forEach((r: Record, h: Handle) => {
        if (!r.changes.has(RT_UNMOUNT))
          r.changes.forEach(prop => {
            CacheResult.markAllPrevRecordsAsOutdated(timestamp, r, prop, triggers);
            const value = r.data[prop];
            if (value instanceof CacheResult) {
              value.subscribeToOwnObservables(timestamp, readstamp, triggers);
              value.complete();
            }
          });
        else
          for (const prop in r.prev.record.data) {
            CacheResult.markAllPrevRecordsAsOutdated(timestamp, r, prop, triggers);
            const value = r.data[prop];
            if (value instanceof CacheResult && value.record === r)
              value.complete();
          }
      });
      snapshot.changeset.forEach((r: Record, h: Handle) =>
        CacheResult.retainPrevObservers(r));
    }
    else {
      snapshot.changeset.forEach((r: Record, h: Handle) => {
        r.changes.forEach(prop => {
          const value = r.data[prop];
          if (value instanceof CacheResult)
            value.complete(error);
        });
      });
    }
  }

  static acquireObserverSet(r: Record, prop: PropertyKey): Set<ICacheResult> {
    let propObservers = r.observers.get(prop);
    if (!propObservers)
      r.observers.set(prop, propObservers = new Set<CacheResult>());
    return propObservers;
  }

  static acquireObservableSet(c: CacheResult, prop: PropertyKey, weak: boolean): Set<Record> {
    let result = weak ? c.weakObservables.get(prop) : c.observables.get(prop);
    if (!result) {
      if (weak)
        c.weakObservables.set(prop, result = new Set<Record>());
      else
        c.observables.set(prop, result = new Set<Record>());
    }
    return result;
  }

  private subscribeToOwnObservables(timestamp: number, readstamp: number, triggers: ICacheResult[]): void {
    const subscriptions: string[] = [];
    this.observables.forEach((records: Set<Record>, prop: PropertyKey) => {
      records.forEach(r => {
        if (!r.replaced.has(prop)) {
          const v = r.data[prop];
          if (!(v instanceof CacheResult) || timestamp < v.invalid.since /*|| (readstamp > v.invalid.since && v.invalid.since !== 0)*/) {
            CacheResult.acquireObserverSet(r, prop).add(this); // now subscribed
            if (Dbg.isOn && Dbg.trace.subscriptions) subscriptions.push(Hint.record(r, prop, true));
          }
          else
            this.invalidateDueTo(v.record, prop, timestamp, triggers, true);
        }
        else
          this.invalidateDueTo(r, prop, timestamp, triggers, true);
      });
    });
    this.weakObservables.forEach((records: Set<Record>, prop: PropertyKey) => {
      records.forEach(r => {
        if (!r.replaced.has(prop)) {
          CacheResult.acquireObserverSet(r, prop).add(this); // now subscribed
          if (Dbg.isOn && Dbg.trace.subscriptions) subscriptions.push(Hint.record(r, prop, true));
        }
        else
          this.invalidateDueTo(r, prop, timestamp, triggers, true);
      });
    });
    if ((Dbg.isOn && Dbg.trace.subscriptions || (this.config.trace && this.config.trace.subscriptions)) && subscriptions.length > 0) Dbg.logAs(this.config.trace, " ", "o", `${Hint.record(this.record, this.member)} is subscribed to {${subscriptions.join(", ")}}.`);
  }

  private unsubscribeFromOwnObservables(): void {
    const subscriptions: string[] = [];
    this.observables.forEach((records: Set<Record>, prop: PropertyKey) => {
      records.forEach(r => {
        const propObservers = r.observers.get(prop);
        if (propObservers)
          propObservers.delete(this); // now unsubscribed
        else
          throw misuse("invariant is broken, please restart the application");
        if (Dbg.isOn && Dbg.trace.subscriptions) subscriptions.push(Hint.record(r, prop, true));
      });
    });
    this.weakObservables.forEach((records: Set<Record>, prop: PropertyKey) => {
      records.forEach(r => {
        const propObservers = r.observers.get(prop);
        if (propObservers)
          propObservers.delete(this); // now unsubscribed
        else
          throw misuse("invariant is broken, please restart the application");
        if (Dbg.isOn && Dbg.trace.subscriptions) subscriptions.push(Hint.record(r, prop, true));
      });
    });
    if ((Dbg.isOn && Dbg.trace.subscriptions || (this.config.trace && this.config.trace.subscriptions)) && subscriptions.length > 0) Dbg.logAs(this.config.trace, " ", "o", `${Hint.record(this.record, this.member)} is unsubscribed from {${subscriptions.join(", ")}}.`);
  }

  static retainPrevObservers(curr: Record): void {
    const prev = curr.prev.record;
    prev.observers.forEach((prevObservers: Set<ICacheResult>, prop: PropertyKey) => {
      if (!curr.changes.has(prop)) {
        const currObservers = curr.observers.get(prop);
        if (currObservers)
          currObservers.forEach(c => prevObservers.add(c));
        curr.observers.set(prop, prevObservers);
        if (Dbg.isOn && Dbg.trace.subscriptions) Dbg.log(" ", "o", `${Hint.record(curr, prop)} inherits observers from ${Hint.record(prev, prop)} (had ${currObservers ? currObservers.size : 0}, now ${prevObservers.size}).`);
      }
      else
        curr.observers.set(prop, new Set<ICacheResult>()); // clear
    });
  }

  invalidateDueTo(cause: Record, causeProp: PropertyKey, since: number, triggers: ICacheResult[], selfInvalidation: boolean): boolean {
    const result = this.invalid.since === TOP_TIMESTAMP || this.invalid.since === 0;
    if (result) {
      this.invalid.since = since;
      const cfg = this.config;
      const isTrigger = cfg.kind === Kind.Trigger && this.record.data[RT_UNMOUNT] !== RT_UNMOUNT;
      if (Dbg.isOn && Dbg.trace.invalidations || (cfg.trace && cfg.trace.invalidations)) Dbg.logAs(cfg.trace, " ", isTrigger ? "■" : "□", isTrigger && cause === this.record && causeProp === this.member ? `${this.hint()} is a trigger and will run automatically` : `${this.hint()} is invalidated due to ${Hint.record(cause, causeProp)} since v${since}${isTrigger ? " and will run automatically" : ""}`);
      if (!selfInvalidation)
        this.unsubscribeFromOwnObservables(); // now unsubscribed
      if (!isTrigger) {
        // Invalidate outer observers (cascade)
        const h: Handle = Utils.get(this.record.data, RT_HANDLE);
        let r: Record = h.head;
        while (r !== Record.blank && !r.replaced.has(this.member)) {
          if (r.data[this.member] === this) {
            const propObservers = r.observers.get(this.member);
            if (propObservers)
              propObservers.forEach(c => c.invalidateDueTo(r, this.member, since, triggers, false));
          }
          r = r.prev.record;
        }
      }
      else
        triggers.push(this);
    }
    return result;
  }

  static markAllPrevRecordsAsOutdated(timestamp: number, head: Record, prop: PropertyKey, triggers: ICacheResult[]): void {
    let r = head.prev.record;
    while (r !== Record.blank && !r.replaced.has(prop)) {
      r.replaced.set(prop, head);
      const propObservers = r.observers.get(prop);
      if (propObservers)
        propObservers.forEach(c => c.invalidateDueTo(head, prop, timestamp, triggers, false));
      // Utils.freezeSet(o);
      r = r.prev.record;
    }
  }

  compute(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args;
    if (!this.error)
      CacheImpl.run(this, CacheResult.computeFunc, proxy, this);
    else
      this.ret = Promise.reject(this.error);
    this.invalid.since = TOP_TIMESTAMP;
  }

  static computeFunc(proxy: any, c: CacheResult): void {
    c.enter();
    try {
      c.ret = c.config.body.call(proxy, ...c.args);
    }
    finally {
      c.leaveOrAsync();
    }
  }

  enter(): void {
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "‾\\", `${Hint.record(this.record, this.member)} - enter`);
    this.started = Date.now();
    if (this.config.monitor)
      this.monitorEnter(this.config.monitor);
  }

  leaveOrAsync(): void {
    if (this.ret instanceof Promise) {
      this.ret = this.ret.then(
        value => {
          this.value = value;
          this.leave(" ▒", "- finished ", "   OK ──┘");
          return value;
        },
        error => {
          this.error = error;
          this.leave(" ▒", "- finished ", "  ERR ──┘");
          throw error;
        });
      if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "_/", `${Hint.record(this.record, this.member)} - leave... `, 0, "ASYNC ──┐");
    }
    else {
      this.value = this.ret;
      this.leave("_/", "- leave");
    }
  }

  private leave(op: string, message: string, highlight: string | undefined = undefined): void {
    if (this.config.monitor)
      this.monitorLeave(this.config.monitor);
    const ms: number = Date.now() - this.started;
    this.started = 0;
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", `${op}`, `${Hint.record(this.record, this.member)} ${message}`, ms, highlight);
    // TODO: handle errors
    // Cache.freeze(this);
  }

  private monitorEnter(mon: Monitor): void {
    CacheImpl.run(undefined, Transaction.runAs, "Monitor.enter",
      true, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
      Monitor.enter, mon, this);
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.outside(() => {
      const leave = () => {
        CacheImpl.run(undefined, Transaction.runAs, "Monitor.leave",
          true, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
          Monitor.leave, mon, this);
      };
      this.tran.whenFinished(false).then(leave, leave);
    });
  }

  complete(error?: any): void {
    const prev = this.record.prev.record.data[this.member];
    if (prev instanceof CacheResult && prev.invalid.renewing === this)
      prev.invalid.renewing = undefined;
  }

  static equal(oldValue: any, newValue: any): boolean {
    let result: boolean;
    if (oldValue instanceof CacheResult)
      result = oldValue.config.kind === Kind.Transaction;
    else
      result = oldValue === newValue;
    return result;
  }

  static freeze(c: CacheResult): void {
    // Utils.freezeMap(c.observables);
    // Utils.freezeSet(c.weakObservables);
    Object.freeze(c);
  }

  static currentTrace(local: Partial<Trace> | undefined): Trace {
    const t = Transaction.current;
    let res = Dbg.merge(t.trace, t.id > 0 ? 31 + t.id % 6 : 37, `T${t.id}`, Dbg.global);
    res = Dbg.merge({margin1: t.margin}, undefined, undefined, res);
    if (CacheResult.active)
      res = Dbg.merge({margin2: CacheResult.active.margin}, undefined, undefined, res);
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
  else if (value instanceof CacheResult) {
    const prevValue = value.record.prev.record.data[value.member];
    const prev = prevValue !== undefined ? prevValue.record : Record.blank;
    result = `<renew:${Hint.record(prev, undefined, true)}>`;
  }
  else if (value === RT_UNMOUNT)
    result = "<unmount>";
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 20);
  else
    result = "◌";
  return result;
}

const original_primise_then = Promise.prototype.then;

function reactronic_then(this: any,
  resolve?: ((value: any) => any | PromiseLike<any>) | undefined | null,
  reject?: ((reason: any) => never | PromiseLike<never>) | undefined | null): Promise<any | never>
{
  const tran = Transaction.current;
  if (!tran.isFinished()) {
    if (!resolve)
      resolve = resolve_return;
    if (!reject)
      reject = reject_rethrow;
    const cache = CacheResult.active;
    if (cache) {
      resolve = cache.bind(resolve);
      reject = cache.bind(reject);
    }
    resolve = tran.bind(resolve, false);
    reject = tran.bind(reject, true);
  }
  return original_primise_then.call(this, resolve, reject);
}

/* istanbul ignore next */
export function resolve_return(value: any): any {
  return value;
}

/* istanbul ignore next */
export function reject_rethrow(error: any): never {
  throw error;
}

// Global Init

function init(): void {
  Dbg.getCurrentTrace = CacheResult.currentTrace;
  Record.markViewed = CacheResult.markViewed; // override
  Record.markChanged = CacheResult.markChanged; // override
  Snapshot.equal = CacheResult.equal; // override
  Snapshot.applyDependencies = CacheResult.applyDependencies; // override
  Hooks.createCacheTrap = CacheImpl.createCacheTrap; // override
  Promise.prototype.then = reactronic_then; // override
}

init();
