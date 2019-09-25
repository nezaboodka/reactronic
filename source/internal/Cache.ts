// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg, Utils, Record, ICacheResult, F, Handle, Snapshot, Hint, Rx, Hooks, RT_HANDLE, RT_CACHE, RT_UNMOUNT } from './all';
import { Status } from '../api/Status';
export { Status, resultof, statusof } from '../api/Status';
import { Reactivity, Kind, Reentrance, Trace } from '../api/Reactivity';
import { Transaction } from '../api/Transaction';
import { Monitor } from '../api/Monitor';

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER;
type CachedCall = { cache: CacheResult, record: Record, valid: boolean };

export class Cache extends Status<any> {
  private readonly handle: Handle;
  private readonly blank: CacheResult;

  get reactivity(): Reactivity { return this.read(false).cache.rx; }
  configure(reactivity: Partial<Reactivity>): Reactivity { return this.reconfigure(reactivity); }
  get args(): ReadonlyArray<any> { return this.read(true).cache.args; }
  get stamp(): number { return this.read(true).record.snapshot.timestamp; }
  get error(): boolean { return this.read(true).cache.error; }
  getResult(args?: any): any { return this.call(false, args).cache.result; }
  get isInvalid(): boolean { return !this.read(true).valid; }
  invalidate(): void { Cache.invalidate(this); }

  constructor(handle: Handle, member: PropertyKey, rx: Rx) {
    super();
    this.handle = handle;
    this.blank = new CacheResult(Record.blank, member, rx);
    CacheResult.freeze(this.blank);
    // TODO: mark cache readonly?
  }

  call(noprev: boolean, args?: any[]): CachedCall {
    let call: CachedCall = this.read(false, args);
    const c: CacheResult = call.cache;
    if (!call.valid && (noprev || !c.invalidated.renewer)) {
      const hint: string = Dbg.isOn && Dbg.trace.hints ? `${Hint.handle(this.handle)}.${c.member.toString()}${args && args.length > 0 && args[0] instanceof Function === false ? `/${args[0]}` : ""}` : /* istanbul ignore next */ "Cache.run";
      const separate = noprev && c.rx.kind === Kind.Transaction ? false : true;
      const token = this.reactivity.kind === Kind.Cached ? this : undefined;
      let call2 = call;
      const ret = Transaction.runAs(hint, separate, c.rx.trace, token, (argsx: any[] | undefined): any => {
        // TODO: Cleaner implementation is needed
        if (call2.cache.tran.isCanceled()) {
          call2 = this.read(false, argsx); // re-read on retry
          if (!call2.valid)
            call2 = this.run(call2.cache, argsx);
        }
        else
          call2 = this.run(call2.cache, argsx);
        return call2.cache.ret;
      }, args);
      call2.cache.ret = ret;
      if (noprev)
        call = call2;
    }
    else
      if (Dbg.isOn && Dbg.trace.methods && (c.rx.trace === undefined || c.rx.trace.methods === undefined || c.rx.trace.methods === true)) Dbg.log(Transaction.current !== Transaction.none ? "║" : "", "  ==", `${Hint.record(call.record)}.${call.cache.member.toString()} is reused (cached by T${call.cache.tran.id} ${call.cache.tran.hint})`);
    Record.markViewed(call.record, call.cache.member);
    return call;
  }

  private read(markViewed: boolean, args?: any[]): CachedCall {
    const ctx = Snapshot.readable();
    const member = this.blank.member;
    const r: Record = ctx.tryRead(this.handle);
    const c: CacheResult = r.data[member] || this.blank;
    const valid = c.rx.kind !== Kind.Transaction &&
      (ctx === c.record.snapshot || ctx.timestamp < c.invalidated.since) &&
      (args === undefined || c.args[0] === args[0]) ||
      r.data[RT_UNMOUNT] === RT_UNMOUNT;
    if (markViewed)
      Record.markViewed(r, c.member);
    return { cache: c, record: r, valid };
  }

  private write(): CachedCall {
    const ctx = Snapshot.writable();
    const member = this.blank.member;
    const r: Record = ctx.write(this.handle, member, this);
    let c: CacheResult = r.data[member] || this.blank;
    if (c.record !== r) {
      const c2 = new CacheResult(r, c.member, c);
      r.data[c2.member] = c2;
      Record.markChanged(r, c2.member, true, c2);
      c = c2;
    }
    return { cache: c, record: r, valid: true };
  }

  private run(prev: CacheResult, args: any[] | undefined): CachedCall {
    const error = this.reenter(prev);
    const call: CachedCall = this.write();
    const c: CacheResult = call.cache;
    if (!error) {
      const mon: Monitor | null = prev.rx.monitor;
      args ? c.args = args : args = c.args;
      prev.invalidated.renewer = c;
      Cache.run(c, (...argsx: any[]): void => {
        c.enter(call.record, mon);
        try
        {
          c.ret = c.rx.body.call(this.handle.proxy, ...argsx);
        }
        finally {
          c.leaveOrAsync(call.record, mon);
        }
      }, ...args);
      c.invalidated.since = TOP_TIMESTAMP;
    }
    else {
      c.ret = Promise.reject(error);
      c.invalidated.since = TOP_TIMESTAMP;
    }
    return call;
  }

  private reenter(c: CacheResult): Error | undefined {
    let error: Error | undefined = undefined;
    const prev = c.invalidated.renewer;
    const caller = Transaction.current;
    if (prev && prev !== c)
      switch (c.rx.reentrance) {
        case Reentrance.PreventWithError:
          throw new Error(`${c.hint()} is configured as non-reentrant`);
        case Reentrance.WaitAndRestart:
          error = new Error(`transaction T${caller.id} (${caller.hint}) will be restarted after T${prev.tran.id} (${prev.tran.hint})`);
          caller.cancel(error, prev.tran);
          // TODO: "c.invalidation.recaching = caller" in order serialize all the transactions
          break;
        case Reentrance.CancelPrevious:
          prev.tran.cancel(new Error(`transaction T${prev.tran.id} (${prev.tran.hint}) is canceled by T${caller.id} (${caller.hint}) and will be silently ignored`), null);
          c.invalidated.renewer = undefined; // allow
          break;
        case Reentrance.RunSideBySide:
          break; // do nothing
      }
    return error;
  }

  static invalidate(self: Cache): void {
    const call = self.write();
    const c = call.cache;
    CacheResult.acquireObservableSet(c, c.member).add(call.record);
    // if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", "  r ", `${c.hint(true)} uses ${Hint.record(r)}.${prop.toString()}`);
  }

  private reconfigure(rx: Partial<Reactivity>): Reactivity {
    const call = this.read(false);
    const c: CacheResult = call.cache;
    const r: Record = call.record;
    const hint: string = Dbg.isOn && Dbg.trace.hints ? `${Hint.handle(this.handle)}.${this.blank.member.toString()}/configure` : /* istanbul ignore next */ "configure";
    return Transaction.runAs(hint, false, undefined, undefined, (): Reactivity => {
      const call2 = this.write();
      const c2: CacheResult = call2.cache;
      c2.rx = new Rx(c2.rx.body, c2.rx, rx, false);
      if (Dbg.isOn && Dbg.trace.writes) Dbg.log("║", "  w ", `${Hint.record(r)}.${c.member.toString()}.rx = ...`);
      return c2.rx;
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

  static createCacheTrap(h: Handle, prop: PropertyKey, rx: Rx): F<any> {
    const cache = new Cache(h, prop, rx);
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
    return Transaction.runAs("unmount", false,
      undefined, undefined, Cache.runUnmount, ...objects);
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
  static asyncTriggerBatch: CacheResult[] = [];
  static active?: CacheResult = undefined;

  readonly tran: Transaction;
  readonly record: Record;
  readonly member: PropertyKey;
  rx: Rx;
  args: any[];
  ret: any;
  result: any;
  error: any;
  started: number;
  readonly invalidated: { since: number, renewer: CacheResult | undefined };
  readonly observables: Map<PropertyKey, Set<Record>>;
  readonly margin: number;

  constructor(record: Record, member: PropertyKey, init: CacheResult | Rx) {
    this.tran = Transaction.current;
    this.record = record;
    this.member = member;
    if (init instanceof CacheResult) {
      this.rx = init.rx;
      this.args = init.args;
      // this.result = init.result;
    }
    else { // init instanceof Rx
      this.rx = init;
      this.args = [];
      // this.result = undefined;
    }
    // this.ret = undefined;
    // this.error = undefined;
    this.started = 0;
    this.invalidated = { since: 0, renewer: undefined };
    this.observables = new Map<PropertyKey, Set<Record>>();
    this.margin = CacheResult.active ? CacheResult.active.margin + 1 : 1;
  }

  hint(tranless?: boolean): string { return `${Hint.record(this.record, tranless, false, this.member)}`; }

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
    const latency = this.rx.latency;
    if (now || latency === -1) {
      if (!this.error && (this.rx.kind === Kind.Transaction ||
          (timestamp >= this.invalidated.since && !this.invalidated.renewer))) {
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

  static markViewed(r: Record, prop: PropertyKey): void {
    const c: CacheResult | undefined = CacheResult.active; // alias
    if (c && c.rx.kind !== Kind.Transaction && prop !== RT_HANDLE) {
      Snapshot.readable().bumpReadStamp(r);
      CacheResult.acquireObservableSet(c, prop).add(r);
      if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", "  r ", `${c.hint()} uses ${Hint.record(r)}.${prop.toString()}`);
    }
  }

  static markChanged(r: Record, prop: PropertyKey, changed: boolean, value: any): void {
    changed ? r.changes.add(prop) : r.changes.delete(prop);
    if (Dbg.isOn && Dbg.trace.writes) Dbg.log("║", "  w ", `${Hint.record(r)}.${prop.toString()} = ${valueHint(value)}`);
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

  static acquireObservableSet(c: CacheResult, prop: PropertyKey): Set<Record> {
    let result: Set<Record> | undefined = c.observables.get(prop);
    if (!result)
      c.observables.set(prop, result = new Set<Record>());
    return result;
  }

  private subscribeToOwnObservables(timestamp: number, readstamp: number, triggers: ICacheResult[]): void {
    const subscriptions: string[] = [];
    this.observables.forEach((records: Set<Record>, prop: PropertyKey) => {
      records.forEach(r => {
        if (!r.replaced.has(prop)) {
          const v = r.data[prop];
          if (v instanceof CacheResult === false || timestamp < v.invalidated.since || (readstamp > v.invalidated.since && v.invalidated.since !== 0)) {
            CacheResult.acquireObserverSet(r, prop).add(this); // now subscribed
            if (Dbg.isOn && Dbg.trace.subscriptions) subscriptions.push(Hint.record(r, false, true, prop));
          }
          else
            this.invalidateDueTo(timestamp, v.record, prop, triggers);
        }
        else
          this.invalidateDueTo(timestamp, r, prop, triggers);
      });
    });
    if ((Dbg.isOn && Dbg.trace.subscriptions || (this.rx.trace && this.rx.trace.subscriptions)) && subscriptions.length > 0) Dbg.logAs(this.rx.trace, " ", "o", `${Hint.record(this.record, false, false, this.member)} is subscribed to {${subscriptions.join(", ")}}.`);
  }

  static mergeObservers(curr: Record, prev: Record): void {
    prev.observers.forEach((prevObservers: Set<ICacheResult>, prop: PropertyKey) => {
      if (!curr.changes.has(prop)) {
        const existing: Set<ICacheResult> | undefined = curr.observers.get(prop);
        const mergedObservers = existing || new Set<ICacheResult>();
        if (!existing)
          curr.observers.set(prop, mergedObservers);
        prevObservers.forEach((prevObserver: ICacheResult) => {
          if (prevObserver.invalidated.since === TOP_TIMESTAMP) {
            mergedObservers.add(prevObserver);
            if (Dbg.isOn && Dbg.trace.subscriptions) Dbg.log(" ", "o", `${prevObserver.hint(false)} is subscribed to {${Hint.record(curr, false, true, prop)}} - inherited from ${Hint.record(prev, false, true, prop)}.`);
          }
        });
      }
    });
  }

  invalidateDueTo(since: number, cause: Record, causeProp: PropertyKey, triggers: ICacheResult[]): boolean {
    const result = this.invalidated.since === TOP_TIMESTAMP || this.invalidated.since === 0;
    if (result) {
      this.invalidated.since = since;
      const isTrigger = this.rx.kind === Kind.Trigger && this.record.data[RT_UNMOUNT] !== RT_UNMOUNT;
      if (Dbg.isOn && Dbg.trace.invalidations || (this.rx.trace && this.rx.trace.invalidations)) Dbg.logAs(this.rx.trace, " ", isTrigger ? "■" : "□", isTrigger && cause === this.record && causeProp === this.member ? `${this.hint(false)} is a trigger and will run automatically` : `${this.hint(false)} is invalidated due to ${Hint.record(cause, false, false, causeProp)} since v${since}${isTrigger ? " and will run automatically" : ""}`);
      if (!isTrigger) {
        // Invalidate outer observers (cascade)
        const h: Handle = Utils.get(this.record.data, RT_HANDLE);
        let r: Record = h.head;
        while (r !== Record.blank && !r.replaced.has(this.member)) {
          if (r.data[this.member] === this) {
            const propObservers = r.observers.get(this.member);
            if (propObservers)
              propObservers.forEach(c => c.invalidateDueTo(since, r, this.member, triggers));
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
        propObservers.forEach(c => c.invalidateDueTo(timestamp, head, prop, triggers));
      // Utils.freezeSet(o);
      r = r.prev.record;
    }
  }

  enter(r: Record, mon: Monitor | null): void {
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "‾\\", `${Hint.record(r)}.${this.member.toString()} - enter`);
    this.started = Date.now();
    this.monitorEnter(mon);
  }

  leaveOrAsync(r: Record, mon: Monitor | null): void {
    if (this.ret instanceof Promise) {
      this.ret = this.ret.then(
        result => {
          this.result = result;
          this.leave(r, mon, "▒▒", "- finished ", "   OK ──┘");
          return result;
        },
        error => {
          this.error = error;
          this.leave(r, mon, "▒▒", "- finished ", "  ERR ──┘");
          throw error;
        });
      if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "_/", `${Hint.record(r)}.${this.member.toString()} - leave... `, 0, "ASYNC ──┐");
    }
    else {
      this.result = this.ret;
      this.leave(r, mon, "_/", "- leave");
    }
  }

  private leave(r: Record, mon: Monitor | null, op: string, message: string, highlight: string | undefined = undefined): void {
    this.monitorLeave(mon);
    const ms: number = Date.now() - this.started;
    this.started = 0;
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", `${op}`, `${Hint.record(r)}.${this.member.toString()} ${message}`, ms, highlight);
    // TODO: handle errors
    // Cache.freeze(this);
  }

  private monitorEnter(mon: Monitor | null): void {
    if (mon)
      Cache.run(undefined, Transaction.runAs, "Monitor.enter",
        true, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
        Monitor.enter, mon, this);
  }

  private monitorLeave(mon: Monitor | null): void {
    if (mon) {
      if (mon.prolonged) {
        const outer = Transaction.current;
        try {
          Transaction._current = Transaction.none; // Workaround?
          const leave = () => {
            Cache.run(undefined, Transaction.runAs, "Monitor.leave",
              true, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
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
          true, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
          Monitor.leave, mon, this);
    }
  }

  complete(error?: any): void {
    const prev = this.record.prev.record.data[this.member];
    if (prev instanceof CacheResult && prev.invalidated.renewer === this)
      prev.invalidated.renewer = undefined;
  }

  static equal(oldValue: any, newValue: any): boolean {
    let result: boolean;
    if (oldValue instanceof CacheResult)
      result = oldValue.rx.kind === Kind.Transaction;
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
    result = `<renew:${Hint.record(prev, false, true)}>`;
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

function reactronicThen(this: any,
  resolve?: ((value: any) => any | PromiseLike<any>) | undefined | null,
  reject?: ((reason: any) => never | PromiseLike<never>) | undefined | null): Promise<any | never>
{
  const t = Transaction.current;
  if (!t.isFinished()) {
    if (!resolve)
      resolve = resolve_return;
    if (!reject)
      reject = reject_rethrow;
    const c = CacheResult.active;
    if (c) {
      resolve = c.bind(resolve);
      reject = c.bind(reject);
    }
    resolve = t.bind(resolve, false);
    reject = t.bind(reject, true);
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
  Promise.prototype.then = reactronicThen; // override
}

init();
