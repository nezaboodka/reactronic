// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Dbg, Utils, undef, Record, ICacheResult, F, Snapshot, Hint } from '../internal/all';
import { Start, Trace } from './Config';

class TranPrettyTrace {
  constructor(readonly tran: Transaction) {}
  get color(): number { return 31 + (this.tran.id) % 6; }
  get prefix(): string { return `t${this.tran.id}`; }
  get margin(): number { return Dbg.trace.margin; }
}

export class Transaction {
  static readonly none: Transaction = new Transaction("none");
  static _current: Transaction;
  static _inspection: boolean = false;
  private readonly snapshot: Snapshot; // assigned in constructor
  private workers: number = 0;
  private sealed: boolean = false;
  private error?: Error = undefined;
  private retryAfter?: Transaction = undefined;
  private resultPromise?: Promise<void> = undefined;
  private resultResolve: (value?: void) => void = undef;
  private resultReject: (reason: any) => void = undef;
  private conflicts?: Record[] = undefined;
  private reaction: { tran?: Transaction, reactives: ICacheResult[] } = { tran: undefined, reactives: [] };
  readonly trace?: Partial<Trace>; // assigned in constructor
  readonly pretty: TranPrettyTrace; // assigned in constructor

  constructor(hint: string, trace?: Partial<Trace>) {
    this.snapshot = new Snapshot(hint);
    this.trace = trace;
    this.pretty = new TranPrettyTrace(this);
  }

  static get current(): Transaction { return Transaction._current; }
  get id(): number { return this.snapshot.id; }
  get hint(): string { return this.snapshot.hint; }

  run<T>(func: F<T>, ...args: any[]): T {
    this.guard();
    return this.do(undefined, func, ...args);
  }

  inspect<T>(func: F<T>, ...args: any[]): T {
    const restore = Transaction._inspection;
    try {
      Transaction._inspection = true;
      if (Dbg.trace.transactions) Dbg.log("", "  ", `transaction t${this.id} (${this.hint}) is being inspected by t${Transaction._current.id} (${Transaction._current.hint})`);
      return this.do(undefined, func, ...args);
    }
    finally {
      Transaction._inspection = restore;
    }
  }

  // wrap<T>(func: F<T>): F<T> {
  //   return Transaction._wrap<T>(this, Ctx.reaction, true, true, func);
  // }

  commit(): void {
    if (this.workers > 0)
      throw new Error("cannot commit transaction having active workers");
    if (this.error)
      throw new Error(`cannot commit transaction that is already canceled: ${this.error}`);
    this.seal(); // commit immediately, because pending === 0
  }

  seal(): this { // t.seal().waitForEnd().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(Transaction.seal, this);
    return this;
  }

  cancel(error: Error, retryAfterOrIgnore?: Transaction | null): this {
    this.do(undefined, Transaction.seal, this, error,
      retryAfterOrIgnore === null ? Transaction.none : retryAfterOrIgnore);
    return this;
  }

  isCanceled(): boolean {
    return this.error !== undefined;
  }

  isFinished(): boolean {
    return this.sealed && this.workers === 0;
  }

  async whenFinished(includingReactions: boolean): Promise<void> {
    if (!this.isFinished())
      await this.acquirePromise();
    if (includingReactions && this.reaction.tran)
      await this.reaction.tran.whenFinished(true);
  }

  async join<T>(p: Promise<T>): Promise<T> {
    const result = await p;
    await this.whenFinished(false);
    return result;
  }

  undo(): void {
    const hint = Dbg.trace.hints ? `Tran#${this.snapshot.hint}.undo` : /* istanbul ignore next */ "noname";
    Transaction.runAs(hint, Start.InsideParent, undefined,
      Snapshot.undo, this.snapshot);
  }

  static run<T>(hint: string, func: F<T>, ...args: any[]): T {
    return Transaction.runAs(hint, Start.InsideParent, undefined, func, ...args);
  }

  static runAs<T>(hint: string, run: Start, trace: Partial<Trace> | undefined, func: F<T>, ...args: any[]): T {
    const t: Transaction = Transaction.acquire(hint, run, trace);
    const root = t !== Transaction._current;
    t.guard();
    let result: any = t.do<T>(trace, func, ...args);
    if (root) {
      if (result instanceof Promise) {
        const outer = Transaction._current;
        try {
          Transaction._current = Transaction.none;
          result = t.autoretry(t.join(result), func, ...args);
        }
        finally {
          Transaction._current = outer;
        }
      }
      t.seal();
    }
    return result;
  }

  // Internal

  private static acquire(hint: string, run: Start, trace: Partial<Trace> | undefined): Transaction {
    const spawn = run !== Start.InsideParent || Transaction._current.isFinished();
    return spawn ? new Transaction(hint, trace) : Transaction._current;
  }

  private guard(): void {
    if (this.error) // prevent from continuing canceled transaction
      throw this.error;
    if (this.sealed && Transaction._current !== this)
      throw new Error("cannot run transaction that is already sealed");
  }

  private async autoretry<T>(p: Promise<T>, func: F<T>, ...args: any[]): Promise<T> {
    try {
      const result = await p;
      return result;
    }
    catch (error) {
      if (this.retryAfter && this.retryAfter !== Transaction.none) {
        // if (Dbg.trace.transactions) Dbg.log("", "  ", `transaction t${this.id} (${this.hint}) is waiting for restart`);
        await this.retryAfter.whenFinished(true);
        // if (Dbg.trace.transactions) Dbg.log("", "  ", `transaction t${this.id} (${this.hint}) is ready for restart`);
        return Transaction.runAs<T>(this.hint, Start.Standalone, this.trace, func, ...args);
      }
      else
        throw error;
    }
  }

  // Internal

  private do<T>(trace: Partial<Trace> | undefined, func: F<T>, ...args: any[]): T {
    let result: T;
    const outer = Transaction._current;
    const restore = Dbg.trace.transactions
      ? (this.trace === undefined || this.trace.transactions !== false
        ? Dbg.push(this.trace, this.pretty)
        : Dbg.trace)
      : (this.trace !== undefined && this.trace.transactions === true
        ? Dbg.push(this.trace, this.pretty)
        : Dbg.trace);
    try {
      if (trace) {
        const t = Dbg.push(trace, this.pretty);
        if (!t.transactions && trace.transactions)
          Dbg.log("║", "i", `transaction hint: ${this.hint}`);
      }
      this.workers++;
      Transaction._current = this;
      this.snapshot.acquire();
      result = func(...args);
      if (this.sealed && this.workers === 1) {
        if (!this.error)
          this.checkForConflicts();
        else if (!this.retryAfter)
          throw this.error;
      }
    }
    catch (e) {
      if (!Transaction._inspection)
        this.cancel(e);
      throw e;
    }
    finally { // it's critical to have no exceptions in this block
      this.workers--;
      if (this.sealed && this.workers === 0) {
        !this.error ? this.performCommit() : this.performCancel();
        Object.freeze(this);
      }
      Transaction._current = outer;
      Dbg.trace = restore;
    }
    if (this.reaction.reactives.length > 0) {
      try {
        Transaction.refreshReactives(this.snapshot.hint,
          this.snapshot.timestamp, this.reaction, this.trace);
      }
      finally {
        if (!this.isFinished())
          this.reaction.reactives = [];
      }
    }
    return result;
  }

  private static seal(t: Transaction, error?: Error, retryAfter?: Transaction): void {
    if (!t.error && error) {
      t.error = error;
      t.retryAfter = retryAfter;
    }
    t.sealed = true;
  }

  private checkForConflicts(): void {
    this.conflicts = this.snapshot.rebase();
    if (this.conflicts)
      this.tryResolveConflicts(this.conflicts);
  }

  private tryResolveConflicts(conflicts: Record[]): void {
    this.error = this.error || new Error(`transaction t${this.id} (${this.hint}) conflicts with other transactions on: ${Hint.conflicts(conflicts)}`);
    throw this.error;
  }

  private performCommit(): void {
    this.snapshot.seal();
    Snapshot.applyDependencies(this.snapshot, this.reaction.reactives);
    this.snapshot.archive();
    if (this.resultPromise)
      this.resultResolve();
  }

  private performCancel(): void {
    this.snapshot.seal(this.error);
    this.snapshot.archive();
    if (this.resultPromise)
      if (!this.retryAfter)
        this.resultReject(this.error);
      else
        this.resultResolve();
  }

  private static refreshReactives(hint: string, timestamp: number, reaction: { tran?: Transaction, reactives: ICacheResult[] }, trace?: Partial<Trace>): void {
    const name = Dbg.trace.hints ? `${hint} - REACTION(${reaction.reactives.length})` : /* istanbul ignore next */ "noname";
    const start = reaction.tran ? Start.InsideParent : Start.Standalone;
    reaction.tran = Transaction.runAs(name, start, trace,
      Transaction.doRefreshReactives, timestamp, reaction.reactives);
  }

  private static doRefreshReactives(timestamp: number, reactives: ICacheResult[]): Transaction {
    reactives.map(r => r.refresh(timestamp, false, false));
    return Transaction.current;
  }

  private acquirePromise(): Promise<void> {
    if (!this.resultPromise) {
      this.resultPromise = new Promise((resolve, reject) => {
        this.resultResolve = resolve;
        this.resultReject = reject;
      });
    }
    return this.resultPromise;
  }

  static _wrap<T>(t: Transaction, c: ICacheResult | undefined, inc: boolean, dec: boolean, func: F<T>): F<T> {
    t.guard();
    const inspect = Transaction._inspection;
    const f = c ? c.wrap(func) : func; // caching context
    const enter = inc ? function() { t.workers++; } : function() { /* nop */ };
    const leave = dec ? function(...args: any[]): T { if (dec) t.workers--; return f(...args); } : f;
    !inspect ? t.do(undefined, enter) : t.inspect(enter);
    const transactional: F<T> = (...args: any[]): T => {
      return !inspect ? t.do<T>(undefined, leave, ...args) : t.inspect<T>(leave, ...args);
    };
    return transactional;
  }

  private static readableSnapshot(): Snapshot {
    return Transaction._current.snapshot;
  }

  private static writableSnapshot(): Snapshot {
    if (Transaction._inspection)
      throw new Error("cannot make changes during inspection");
    return Transaction._current.snapshot;
  }

  static _init(): void {
    Snapshot.readable = Transaction.readableSnapshot; // override
    Snapshot.writable = Transaction.writableSnapshot; // override
    Transaction.none.sealed = true;
    Transaction.none.snapshot.seal();
    Transaction._current = Transaction.none;
    const blank = new Record(Record.blank, Transaction.none.snapshot, {});
    blank.prev.record = blank; // loopback
    blank.freeze();
    Utils.freezeMap(blank.observers);
    Utils.freezeMap(blank.outdated);
    Record.blank = blank;
  }
}

Transaction._init();
