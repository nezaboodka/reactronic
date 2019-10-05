// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg, misuse, Utils, Record, PropKey, PropValue, PropHint, ICacheResult, F, Handle, Snapshot, Hint, Cfg, Hooks, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from './all';
import { Cache } from '../api/Cache';
export { Cache, cacheof, resolved } from '../api/Cache';
import { Config, Kind, Reentrance, Trace } from '../api/Config';
import { Transaction } from '../api/Transaction';
import { Monitor } from '../api/Monitor';

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER;
type CacheCall = { valid: boolean, cache: CacheResult, record: Record };

export class CacheImpl extends Cache<any> {
  private readonly handle: Handle;
  private readonly blank: CacheResult;

  configure(config: Partial<Config>): Config { return this.reconfigure(config); }
  get config(): Config { return this.weak().cache.config; }
  get args(): ReadonlyArray<any> { return this.weak().cache.args; }
  get value(): any { return this.recall(true).cache.value; }
  get error(): boolean { return this.weak().cache.error; }
  get stamp(): number { return this.weak().record.snapshot.timestamp; }
  get isInvalid(): boolean { return !this.weak().valid; }
  invalidate(): void { CacheImpl.invalidate(this); }
  call(args?: any): any { return this.recall(true, args).cache.value; }

  constructor(handle: Handle, member: PropKey, config: Cfg) {
    super();
    this.handle = handle;
    this.blank = new CacheResult(Record.blank, member, config);
    CacheResult.freeze(this.blank);
  }

  private initialize(): CacheResult {
    const hint: string = Dbg.isOn ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/init` : /* istanbul ignore next */ "Cache.init";
    const sidebyside = this.blank.config.reentrance === Reentrance.RunSideBySide;
    const result = Transaction.runAs(hint, true, sidebyside, this.blank.config.trace, this, (): CacheResult => {
      const c = this.write().cache;
      c.ret = undefined;
      c.value = undefined;
      c.invalid.since = -1;
      return c;
    });
    this.blank.invalid.renewing = undefined;
    return result;
  }

  recall(weak: boolean, args?: any[]): CacheCall {
    let call: CacheCall = this.read(args);
    const c: CacheResult = call.cache;
    if (!call.valid && (!weak || !c.invalid.renewing)) {
      const hint: string = Dbg.isOn ? `${Hint.handle(this.handle)}.${c.member.toString()}${args && args.length > 0 && args[0] instanceof Function === false ? `/${args[0]}` : ""}` : /* istanbul ignore next */ "Cache.run";
      const cfg = c.config;
      const spawn = weak || cfg.kind !== Kind.Transaction;
      const sidebyside = cfg.reentrance === Reentrance.RunSideBySide;
      const token = cfg.kind === Kind.Cached ? this : undefined;
      let call2 = call;
      const ret = Transaction.runAs(hint, spawn, sidebyside, cfg.trace, token, (argsx: any[] | undefined): any => {
        // TODO: Cleaner implementation is needed
        if (call2.cache.tran.isCanceled()) {
          call2 = this.read(argsx); // re-read on retry
          if (!call2.valid) {
            call2 = this.write();
            call2.cache.compute(this.handle.proxy, argsx);
          }
        }
        else {
          call2 = this.write();
          call2.cache.compute(this.handle.proxy, argsx);
        }
        return call2.cache.ret;
      }, args);
      call2.cache.ret = ret;
      if (!weak && Snapshot.read().timestamp >= call2.cache.record.snapshot.timestamp)
        call = call2;
    }
    else
      if (Dbg.isOn && Dbg.trace.methods && (c.config.trace === undefined || c.config.trace.methods === undefined || c.config.trace.methods === true)) Dbg.log(Transaction.current !== Transaction.none ? "║" : "", "  ==", `${Hint.record(call.record)}.${call.cache.member.toString()} is reused (cached by T${call.cache.tran.id} ${call.cache.tran.hint})`);
    Record.markViewed(call.record, call.cache.member, call.cache, weak);
    return call;
  }

  private weak(): CacheCall {
    const call = this.read(undefined);
    Record.markViewed(call.record, call.cache.member, call.cache, true);
    return call;
  }

  private read(args: any[] | undefined): CacheCall {
    const ctx = Snapshot.read();
    const r: Record = ctx.tryRead(this.handle);
    const c: CacheResult = r.data[this.blank.member] || this.initialize();
    const valid = c.config.kind !== Kind.Transaction &&
      (ctx === c.record.snapshot || ctx.timestamp < c.invalid.since) &&
      (args === undefined || c.args[0] === args[0]) ||
      r.data[RT_UNMOUNT] !== undefined;
    return { valid, cache: c, record: r };
  }

  private write(): CacheCall {
    const ctx = Snapshot.write();
    const member = this.blank.member;
    const r: Record = ctx.write(this.handle, member, RT_HANDLE, this);
    let c: CacheResult = r.data[member] || this.blank;
    if (c.record !== r) {
      const renewing = new CacheResult(r, member, c);
      r.data[member] = renewing;
      renewing.error = CacheImpl.checkForReentrance(c);
      if (!renewing.error)
        c.invalid.renewing = renewing;
      c = renewing;
      ctx.bumpBy(r.prev.record.snapshot.timestamp);
      Record.markChanged(r, member, true, renewing);
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
    const call = self.write();
    const c = call.cache;
    c.getObservableSet(false).set(c, {record: call.record, prop: c.member}); // c.member
    // if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", "  r ", `${c.hint(true)} uses ${Hint.record(r, prop)}`);
  }

  private reconfigure(config: Partial<Config>): Config {
    const call = this.read(undefined);
    const c: CacheResult = call.cache;
    const r: Record = call.record;
    const hint: string = Dbg.isOn ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : /* istanbul ignore next */ "configure";
    return Transaction.runAs(hint, false, false, undefined, undefined, (): Config => {
      const call2 = this.write();
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

  static createCacheTrap(h: Handle, prop: PropKey, config: Cfg): F<any> {
    const cache = new CacheImpl(h, prop, config);
    const cacheTrap: F<any> = (...args: any[]): any =>
      cache.recall(false, args).cache.ret;
    Utils.set(cacheTrap, RT_CACHE, cache);
    return cacheTrap;
  }

  static of(method: F<any>): Cache<any> {
    const impl: Cache<any> | undefined = Utils.get(method, RT_CACHE);
    if (!impl)
      throw misuse("given method is not a reactronic cache");
    return impl;
  }

  static unmount(...objects: any[]): Transaction {
    return Transaction.runAs("<unmount>", false, false,
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

class CacheResult extends PropValue implements ICacheResult {
  static asyncTriggerBatch: CacheResult[] = [];
  static active?: CacheResult = undefined;

  readonly tran: Transaction;
  readonly record: Record;
  readonly member: PropKey;
  config: Cfg;
  args: any[];
  ret: any;
  error: any;
  started: number;
  readonly invalid: { since: number, renewing: CacheResult | undefined };
  readonly observables: Map<PropValue, PropHint>;
  readonly weakObservables: Map<PropValue, PropHint>;
  readonly margin: number;

  constructor(record: Record, member: PropKey, init: CacheResult | Cfg) {
    super(undefined);
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
    this.observables = new Map<PropValue, PropHint>();
    this.weakObservables = new Map<PropValue, PropHint>();
    this.margin = CacheResult.active ? CacheResult.active.margin + 1 : 1;
  }

  hint(): string { return `${Hint.record(this.record, this.member)}`; }

  get isCopiedOnWrite(): boolean { return false; }

  bind<T>(func: F<T>): F<T> {
    const Cache_run: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, "║", "‾\\", `${Hint.record(this.record)}.${this.member.toString()} - step in  `, 0, "        │");
      const result = CacheImpl.run<T>(this, func, ...args);
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, "║", "_/", `${Hint.record(this.record)}.${this.member.toString()} - step out `, 0, this.started > 0 ? "        │" : "");
      return result;
    };
    return Cache_run;
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
    if (this.config.monitor)
      this.monitorEnter(this.config.monitor);
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "‾\\", `${Hint.record(this.record, this.member)} - enter`);
    this.started = Date.now();
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
    const ms: number = Date.now() - this.started;
    this.started = 0;
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", `${op}`, `${Hint.record(this.record, this.member)} ${message}`, ms, highlight);
    if (this.config.monitor)
      this.monitorLeave(this.config.monitor);
    // CacheResult.freeze(this);
  }

  private monitorEnter(mon: Monitor): void {
    CacheImpl.run(undefined, Transaction.runAs, "Monitor.enter",
      true, false, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
      Monitor.enter, mon, this);
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.outside(() => {
      const leave = () => {
        CacheImpl.run(undefined, Transaction.runAs, "Monitor.leave",
          true, false, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
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

  renew(timestamp: number, now: boolean, nothrow: boolean): void {
    const latency = this.config.latency;
    if (now || latency === -1) {
      if (!this.error && (this.config.kind === Kind.Transaction ||
          (timestamp >= this.invalid.since && !this.invalid.renewing))) {
        try {
          const proxy: any = Utils.get(this.record.data, RT_HANDLE).proxy;
          const trap: Function = Reflect.get(proxy, this.member, proxy);
          const cache: CacheImpl = Utils.get(trap, RT_CACHE);
          const call: CacheCall = cache.recall(false);
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
      this.addToAsyncTriggerBatch();
    else if (latency > 0) // ignore disabled triggers (latency -2)
      setTimeout(() => this.renew(TOP_TIMESTAMP, true, true), latency);
  }

  private addToAsyncTriggerBatch(): void {
    CacheResult.asyncTriggerBatch.push(this);
    if (CacheResult.asyncTriggerBatch.length === 1)
      setTimeout(CacheResult.processAsyncTriggerBatch, 0);
  }

  private static processAsyncTriggerBatch(): void {
    const triggers = CacheResult.asyncTriggerBatch;
    CacheResult.asyncTriggerBatch = []; // reset
    for (const t of triggers)
      t.renew(TOP_TIMESTAMP, true, true);
  }

  private static markViewed(record: Record, prop: PropKey, value: PropValue, weak: boolean): void {
    const c: CacheResult | undefined = CacheResult.active; // alias
    if (c && c.config.kind !== Kind.Transaction && prop !== RT_HANDLE) {
      Snapshot.read().bumpBy(record.snapshot.timestamp);
      c.getObservableSet(weak).set(value, {record, prop});
      if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", `  ${weak ? 's' : 'r'} `, `${c.hint()} ${weak ? 'weakly uses' : 'uses'} ${Hint.record(record, prop)}`);
    }
  }

  private static markChanged(r: Record, prop: PropKey, changed: boolean, value: any): void {
    changed ? r.changes.add(prop) : r.changes.delete(prop);
    if (Dbg.isOn && Dbg.trace.writes)
      if (changed)
        Dbg.log("║", "  w ", `${Hint.record(r, prop)} = ${valueHint(value)}`);
      else
        Dbg.log("║", "  w ", `${Hint.record(r, prop)} = ${valueHint(value)}`, undefined, " (same as previous)");
    }

  private static applyAllDependencies(snapshot: Snapshot, error?: any): void {
    const timestamp = snapshot.timestamp;
    if (error === undefined) {
      const triggers = snapshot.triggers;
      snapshot.changeset.forEach((r: Record, h: Handle) => {
        if (!r.changes.has(RT_UNMOUNT))
          r.changes.forEach(prop => {
            CacheResult.markPrevValueAsReplaced(timestamp, r, prop, triggers);
            CacheResult.completePropChange(timestamp, r, prop, triggers);
          });
        else
          for (const prop in r.prev.record.data) {
            CacheResult.markPrevValueAsReplaced(timestamp, r, prop, triggers);
            CacheResult.completePropChange(timestamp, r, prop);
          }
      });
    }
    else
      snapshot.changeset.forEach((r: Record, h: Handle) =>
        r.changes.forEach(prop => CacheResult.completePropChange(timestamp, r, prop)));
  }

  private static completePropChange(timestamp: number, record: Record, prop: PropKey, triggers?: ICacheResult[]): void {
    const cache = record.data[prop];
    if (cache instanceof CacheResult && cache.record === record) {
      if (triggers)
        cache.subscribeToAllObservables(timestamp, triggers);
      cache.complete();
    }
}

  private static markPrevValueAsReplaced(timestamp: number, record: Record, prop: PropKey, triggers: ICacheResult[]): void {
    const prev = record.prev.record;
    const value = prev.data[prop] as PropValue;
    if (value !== undefined && value.replacedBy === undefined) {
      value.replacedBy = record;
      // if (value instanceof CacheResult)
      //   value.unsubscribeFromAllObservables();
      // if (value.observers)
      //   value.observers.forEach(c => c.invalidateDueTo({ record: head, prop }, value, timestamp, triggers, true));
      if (value instanceof CacheResult && (value.invalid.since === TOP_TIMESTAMP || value.invalid.since === 0)) {
        value.invalid.since = timestamp;
        value.unsubscribeFromAllObservables();
      }
      if (value.observers)
        value.observers.forEach(c => c.invalidateDueTo(value, { record, prop }, timestamp, triggers, true));
    }
  }

  private subscribeToAllObservables(timestamp: number, triggers: ICacheResult[]): void {
    const log: string[] = [];
    this.subscribeTo(false, this.observables, timestamp, triggers, log);
    this.subscribeTo(true, this.weakObservables, timestamp, triggers, log);
    if ((Dbg.isOn && Dbg.trace.subscriptions || (this.config.trace && this.config.trace.subscriptions)) && log.length > 0) Dbg.logAs(this.config.trace, " ", "o", `${Hint.record(this.record, this.member)} is subscribed to {${log.join(", ")}}.`);
  }

  private unsubscribeFromAllObservables(): void {
    const log: string[] = [];
    this.unsubscribeFrom(this.observables, log);
    this.unsubscribeFrom(this.weakObservables, log);
    if ((Dbg.isOn && Dbg.trace.subscriptions || (this.config.trace && this.config.trace.subscriptions)) && log.length > 0) Dbg.logAs(this.config.trace, " ", "o", `${Hint.record(this.record, this.member)} is unsubscribed from {${log.join(", ")}}.`);
  }

  private subscribeTo(weak: boolean, observables: Map<PropValue, PropHint>, timestamp: number, triggers: ICacheResult[], log: string[]): void {
    const t = weak ? -1 : timestamp;
    observables.forEach((hint, val) => {
        if (!this.subscribeToPropValue(val, hint, t, log))
          this.invalidateDueTo(val, hint, timestamp, triggers, false);
    });
  }

  private unsubscribeFrom(observables: Map<PropValue, PropHint>, log: string[]): void {
    observables.forEach((hint, val) => this.unsubscribeFromPropValue(val, hint, log));
  }

  private subscribeToPropValue(value: PropValue, hint: PropHint, timestamp: number, log: string[]): boolean {
    let result = value.replacedBy === undefined;
    if (result && timestamp !== -1)
      result = !(value instanceof CacheResult && timestamp >= value.invalid.since);
    if (result) {
      if (!value.observers)
        value.observers = new Set<CacheResult>(); // acquire
      value.observers.add(this); // now subscribed
      if (Dbg.isOn && Dbg.trace.subscriptions) log.push(Hint.record(hint.record, hint.prop, true));
    }
    return result;
  }

  private unsubscribeFromPropValue(value: PropValue, hint: PropHint, log: string[]): void {
    const observers = value.observers;
    if (observers)
      observers.delete(this); // now unsubscribed
    if (Dbg.isOn && Dbg.trace.subscriptions) log.push(Hint.record(hint.record, hint.prop, true));
  }

  getObservableSet(weak: boolean): Map<PropValue, PropHint> {
    return weak ? this.weakObservables : this.observables;
  }

  invalidateDueTo(cause: PropValue, hint: PropHint, since: number, triggers: ICacheResult[], unsubscribe: boolean): boolean {
    const result = this.invalid.since === TOP_TIMESTAMP || this.invalid.since === 0;
    if (result) {
      this.invalid.since = since;
      const isTrigger = this.config.kind === Kind.Trigger && this.record.data[RT_UNMOUNT] === undefined;
      if (Dbg.isOn && Dbg.trace.invalidations || (this.config.trace && this.config.trace.invalidations)) Dbg.logAs(this.config.trace, " ", isTrigger ? "■" : "□", isTrigger && hint.record === this.record && hint.prop === this.member ? `${this.hint()} is a trigger and will run automatically` : `${this.hint()} is invalidated due to ${Hint.record(hint.record, hint.prop)} since v${since}${isTrigger ? " and will run automatically" : ""}`);
      if (unsubscribe)
        this.unsubscribeFromAllObservables(); // now unsubscribed
      if (isTrigger)
        triggers.push(this);
      else if (this.observers) // cascade invalidation
          this.observers.forEach(c => c.invalidateDueTo(this, {record: this.record, prop: this.member}, since, triggers, true));
    }
    return result;
  }

  static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue;
    if (result)
      result = oldValue instanceof CacheResult && oldValue.invalid.since !== -1;
    return result;
  }

  static freeze(c: CacheResult): void {
    Utils.freezeMap(c.observables);
    Utils.freezeMap(c.weakObservables);
    Object.freeze(c);
  }

  static init(): void {
    Dbg.getCurrentTrace = getCurrentTrace;
    Record.markViewed = CacheResult.markViewed; // override
    Record.markChanged = CacheResult.markChanged; // override
    Snapshot.isConflicting = CacheResult.isConflicting; // override
    Snapshot.applyAllDependencies = CacheResult.applyAllDependencies; // override
    Hooks.createCacheTrap = CacheImpl.createCacheTrap; // override
    Promise.prototype.then = reactronic_then; // override
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
    result = `<renew:${Hint.record(value.record.prev.record, undefined, true)}>`;
  else if (value === RT_UNMOUNT)
    result = "<unmount>";
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 20);
  else
    result = "◌";
  return result;
}

function getCurrentTrace(local: Partial<Trace> | undefined): Trace {
  const t = Transaction.current;
  let res = Dbg.merge(t.trace, t.id > 0 ? 31 + t.id % 6 : 37, `T${t.id}`, Dbg.global);
  res = Dbg.merge({margin1: t.margin}, undefined, undefined, res);
  if (CacheResult.active)
    res = Dbg.merge({margin2: CacheResult.active.margin}, undefined, undefined, res);
  if (local)
    res = Dbg.merge(local, undefined, undefined, res);
  return res;
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

CacheResult.init();
