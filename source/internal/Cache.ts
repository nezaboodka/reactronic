// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg, misuse, Utils, Record, ICacheResult, F, Handle, Snapshot, Hint, Rt, Hooks, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from './all';
import { Status } from '../api/Status';
export { Status, resultof, statusof } from '../api/Status';
import { Reactivity, Kind, Reentrance, Trace } from '../api/Reactivity';
import { Transaction } from '../api/Transaction';
import { Monitor } from '../api/Monitor';

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER;
type CacheCall = { valid: boolean, cache: CacheResult, record: Record, error?: Error };

export class Cache extends Status<any> {
  private readonly handle: Handle;
  private readonly blank: CacheResult;

  get reactivity(): Reactivity { return this.readable(true).cache.rt; }
  configure(reactivity: Partial<Reactivity>): Reactivity { return this.reconfigure(reactivity); }
  get args(): ReadonlyArray<any> { return this.readable(true).cache.args; }
  get stamp(): number { return this.readable(true).record.snapshot.timestamp; }
  get error(): boolean { return this.readable(true).cache.error; }
  getResult(args?: any): any { return this.call(true, args).cache.value; }
  get isInvalid(): boolean { return !this.readable(true).valid; }
  invalidate(): void { Cache.invalidate(this); }

  constructor(handle: Handle, member: PropertyKey, rt: Rt) {
    super();
    this.handle = handle;
    this.blank = new CacheResult(Record.blank, member, rt);
    CacheResult.freeze(this.blank);
    // TODO: mark cache readonly?
  }

  call(status: boolean, args?: any[]): CacheCall {
    let call: CacheCall = this.readable(false, args);
    const c: CacheResult = call.cache;
    if (!call.valid && (!status || !c.invalid.renewing)) {
      const hint: string = Dbg.isOn && Dbg.trace.hints ? `${Hint.handle(this.handle)}.${c.member.toString()}${args && args.length > 0 && args[0] instanceof Function === false ? `/${args[0]}` : ""}` : /* istanbul ignore next */ "Cache.run";
      const spawn = !status && c.rt.kind === Kind.Transaction ? false : true;
      const token = c.rt.kind === Kind.Cached ? this : undefined;
      let call2 = call;
      const ret = Transaction.runAs(hint, spawn, c.rt.trace, token, (argsx: any[] | undefined): any => {
        // TODO: Cleaner implementation is needed
        if (call2.cache.tran.isCanceled()) {
          call2 = this.readable(false, argsx); // re-read on retry
          if (!call2.valid) {
            call2 = this.writable();
            call2.cache.compute(this.handle.proxy, call2.error, argsx);
          }
        }
        else {
          call2 = this.writable();
          call2.cache.compute(this.handle.proxy, call2.error, argsx);
        }
        return call2.cache.ret;
      }, args);
      call2.cache.ret = ret;
      // TODO: Get rid of noprev
      if (!status && Snapshot.readable().timestamp >= call2.cache.record.snapshot.timestamp)
        call = call2;
    }
    else
      if (Dbg.isOn && Dbg.trace.methods && (c.rt.trace === undefined || c.rt.trace.methods === undefined || c.rt.trace.methods === true)) Dbg.log(Transaction.current !== Transaction.none ? "║" : "", "  ==", `${Hint.record(call.record)}.${call.cache.member.toString()} is reused (cached by T${call.cache.tran.id} ${call.cache.tran.hint})`);
    Record.markViewed(call.record, call.cache.member, status);
    return call;
  }

  private readable(status: boolean, args?: any[]): CacheCall {
    const ctx = Snapshot.readable();
    const r: Record = ctx.tryRead(this.handle);
    const c: CacheResult = r.data[this.blank.member] || this.blank;
    const valid = c.rt.kind !== Kind.Transaction &&
      (ctx === c.record.snapshot || ctx.timestamp < c.invalid.since) &&
      (args === undefined || c.args[0] === args[0]) ||
      r.data[RT_UNMOUNT] === RT_UNMOUNT;
    if (status)
      Record.markViewed(r, c.member, true);
    return { valid, cache: c, record: r };
  }

  private writable(): CacheCall {
    const ctx = Snapshot.writable();
    const member = this.blank.member;
    const r: Record = ctx.writable(this.handle, member, this);
    let c: CacheResult = r.data[member] || this.blank;
    let error: Error | undefined = undefined;
    if (c.record !== r) {
      error = Cache.checkForReentrance(c);
      if (!error) {
        const renewing = new CacheResult(r, member, c);
        r.data[member] = renewing;
        Record.markChanged(r, member, true, renewing);
        c.invalid.renewing = renewing;
        c = renewing;
      }
    }
    return { valid: true, cache: c, record: r, error };
  }

  private static checkForReentrance(c: CacheResult): Error | undefined {
    let result: Error | undefined = undefined;
    const prev = c.invalid.renewing;
    const caller = Transaction.current;
    if (prev && prev !== c)
      switch (c.rt.reentrance) {
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

  static invalidate(self: Cache): void {
    const call = self.writable();
    const c = call.cache;
    CacheResult.acquireObservableSet(c, c.member, false).add(call.record);
    // if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", "  r ", `${c.hint(true)} uses ${Hint.record(r, prop)}`);
  }

  private reconfigure(rt: Partial<Reactivity>): Reactivity {
    const call = this.readable(false);
    const c: CacheResult = call.cache;
    const r: Record = call.record;
    const hint: string = Dbg.isOn && Dbg.trace.hints ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : /* istanbul ignore next */ "configure";
    return Transaction.runAs(hint, false, undefined, undefined, (): Reactivity => {
      const call2 = this.writable();
      const c2: CacheResult = call2.cache;
      c2.rt = new Rt(c2.rt.body, c2.rt, rt, false);
      if (Dbg.isOn && Dbg.trace.writes) Dbg.log("║", "  w ", `${Hint.record(r)}.${c.member.toString()}.rt = ...`);
      return c2.rt;
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

  static createCacheTrap(h: Handle, prop: PropertyKey, rt: Rt): F<any> {
    const cache = new Cache(h, prop, rt);
    const cacheTrap: F<any> = (...args: any[]): any =>
      cache.call(false, args).cache.ret;
    Utils.set(cacheTrap, RT_CACHE, cache);
    return cacheTrap;
  }

  static get(method: F<any>): Status<any> {
    const impl: Status<any> | undefined = Utils.get(method, RT_CACHE);
    if (!impl)
      throw misuse("given method is not a reactronic cache");
    return impl;
  }

  static unmount(...objects: any[]): Transaction {
    return Transaction.runAs("<unmount>", false,
      undefined, undefined, Cache.unmountFunc, ...objects);
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
  rt: Rt;
  args: any[];
  ret: any;
  value: any;
  error: any;
  started: number;
  readonly invalid: { since: number, renewing: CacheResult | undefined };
  readonly observables: Map<PropertyKey, Set<Record>>;
  readonly statusObservables: Map<PropertyKey, Set<Record>>;
  readonly margin: number;

  constructor(record: Record, member: PropertyKey, init: CacheResult | Rt) {
    this.tran = Transaction.current;
    this.record = record;
    this.member = member;
    if (init instanceof CacheResult) {
      this.rt = init.rt;
      this.args = init.args;
      // this.value = init.value;
    }
    else { // init instanceof Rx
      this.rt = init;
      this.args = [];
      // this.value = undefined;
    }
    // this.ret = undefined;
    // this.error = undefined;
    this.started = 0;
    this.invalid = { since: 0, renewing: undefined };
    this.observables = new Map<PropertyKey, Set<Record>>();
    this.statusObservables = new Map<PropertyKey, Set<Record>>();
    this.margin = CacheResult.active ? CacheResult.active.margin + 1 : 1;
  }

  hint(): string { return `${Hint.record(this.record, this.member)}`; }

  bind<T>(func: F<T>): F<T> {
    const Cache_run: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, "║", "‾\\", `${Hint.record(this.record)}.${this.member.toString()} - step in  `, 0, "        │");
      const result = Cache.run<T>(this, func, ...args);
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, "║", "_/", `${Hint.record(this.record)}.${this.member.toString()} - step out `, 0, this.started > 0 ? "        │" : "");
      return result;
    };
    return Cache_run;
  }

  renew(timestamp: number, now: boolean, nothrow: boolean): void {
    const latency = this.rt.latency;
    if (now || latency === -1) {
      if (!this.error && (this.rt.kind === Kind.Transaction ||
          (timestamp >= this.invalid.since && !this.invalid.renewing))) {
        try {
          const proxy: any = Utils.get(this.record.data, RT_HANDLE).proxy;
          const trap: Function = Reflect.get(proxy, this.member, proxy);
          const cache: Cache = Utils.get(trap, RT_CACHE);
          const call: CacheCall = cache.call(false);
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

  static markViewed(r: Record, prop: PropertyKey, status: boolean): void {
    const c: CacheResult | undefined = CacheResult.active; // alias
    if (c && c.rt.kind !== Kind.Transaction && prop !== RT_HANDLE) {
      Snapshot.readable().bumpReadStamp(r);
      CacheResult.acquireObservableSet(c, prop, status).add(r);
      if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", `  ${status ? 's' : 'r'} `, `${c.hint()} ${status ? 'gets status of' : 'uses'} ${Hint.record(r, prop)}`);
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
      snapshot.changeset.forEach((r: Record, h: Handle) => {
        CacheResult.mergeObservers(r, r.prev.record);
      });
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

  static acquireObservableSet(c: CacheResult, prop: PropertyKey, status: boolean): Set<Record> {
    let result = status ? c.statusObservables.get(prop) : c.observables.get(prop);
    if (!result) {
      if (status)
        c.statusObservables.set(prop, result = new Set<Record>());
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
            this.invalidateDueTo(v.record, prop, timestamp, triggers);
        }
        else
          this.invalidateDueTo(r, prop, timestamp, triggers);
      });
    });
    this.statusObservables.forEach((records: Set<Record>, prop: PropertyKey) => {
      records.forEach(r => {
        if (!r.replaced.has(prop)) {
          CacheResult.acquireObserverSet(r, prop).add(this); // now subscribed
          if (Dbg.isOn && Dbg.trace.subscriptions) subscriptions.push(Hint.record(r, prop, true));
        }
        else
          this.invalidateDueTo(r, prop, timestamp, triggers);
      });
    });
    if ((Dbg.isOn && Dbg.trace.subscriptions || (this.rt.trace && this.rt.trace.subscriptions)) && subscriptions.length > 0) Dbg.logAs(this.rt.trace, " ", "o", `${Hint.record(this.record, this.member)} is subscribed to {${subscriptions.join(", ")}}.`);
  }

  static mergeObservers(curr: Record, prev: Record): void {
    prev.observers.forEach((prevObservers: Set<ICacheResult>, prop: PropertyKey) => {
      if (!curr.changes.has(prop)) {
        const existing: Set<ICacheResult> | undefined = curr.observers.get(prop);
        const mergedObservers = existing || new Set<ICacheResult>();
        if (!existing)
          curr.observers.set(prop, mergedObservers);
        prevObservers.forEach((prevObserver: ICacheResult) => {
          if (prevObserver.invalid.since === TOP_TIMESTAMP) {
            mergedObservers.add(prevObserver);
            if (Dbg.isOn && Dbg.trace.subscriptions) Dbg.log(" ", "o", `${prevObserver.hint(false)} is subscribed to {${Hint.record(curr, prop, true)}} - inherited from ${Hint.record(prev, prop, true)}.`);
          }
        });
      }
    });
  }

  invalidateDueTo(cause: Record, causeProp: PropertyKey, since: number, triggers: ICacheResult[]): boolean {
    const result = this.invalid.since === TOP_TIMESTAMP || this.invalid.since === 0;
    if (result) {
      this.invalid.since = since;
      const isTrigger = this.rt.kind === Kind.Trigger && this.record.data[RT_UNMOUNT] !== RT_UNMOUNT;
      if (Dbg.isOn && Dbg.trace.invalidations || (this.rt.trace && this.rt.trace.invalidations)) Dbg.logAs(this.rt.trace, " ", isTrigger ? "■" : "□", isTrigger && cause === this.record && causeProp === this.member ? `${this.hint()} is a trigger and will run automatically` : `${this.hint()} is invalidated due to ${Hint.record(cause, causeProp)} since v${since}${isTrigger ? " and will run automatically" : ""}`);
      if (!isTrigger) {
        // Invalidate outer observers (cascade)
        const h: Handle = Utils.get(this.record.data, RT_HANDLE);
        let r: Record = h.head;
        while (r !== Record.blank && !r.replaced.has(this.member)) {
          if (r.data[this.member] === this) {
            const propObservers = r.observers.get(this.member);
            if (propObservers)
              propObservers.forEach(c => c.invalidateDueTo(r, this.member, since, triggers));
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
        propObservers.forEach(c => c.invalidateDueTo(head, prop, timestamp, triggers));
      // Utils.freezeSet(o);
      r = r.prev.record;
    }
  }

  compute(proxy: any, error: Error | undefined, args: any[] | undefined): void {
    if (args)
      this.args = args;
    if (!error)
      Cache.run(this, CacheResult.computeFunc, proxy, this);
    else
      this.ret = Promise.reject(error);
    this.invalid.since = TOP_TIMESTAMP;
  }

  static computeFunc(proxy: any, c: CacheResult): void {
    c.enter();
    try {
      c.ret = c.rt.body.call(proxy, ...c.args);
    }
    finally {
      c.leaveOrAsync();
    }
  }

  enter(): void {
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "‾\\", `${Hint.record(this.record, this.member)} - enter`);
    this.started = Date.now();
    if (this.rt.monitor)
      this.monitorEnter(this.rt.monitor);
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
    if (this.rt.monitor)
      this.monitorLeave(this.rt.monitor);
    const ms: number = Date.now() - this.started;
    this.started = 0;
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", `${op}`, `${Hint.record(this.record, this.member)} ${message}`, ms, highlight);
    // TODO: handle errors
    // Cache.freeze(this);
  }

  private monitorEnter(mon: Monitor): void {
    Cache.run(undefined, Transaction.runAs, "Monitor.enter",
      true, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
      Monitor.enter, mon, this);
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.outside(() => {
      const leave = () => {
        Cache.run(undefined, Transaction.runAs, "Monitor.leave",
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
      result = oldValue.rt.kind === Kind.Transaction;
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
  Hooks.createCacheTrap = Cache.createCacheTrap; // override
  Promise.prototype.then = reactronic_then; // override
}

init();
