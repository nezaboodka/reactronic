import { Dbg, Utils, undef, Record, ICachedResult, F, Handle, Snapshot, Hint } from './internal/z.index';
import { SeparateFrom, Trace } from './Config';

class TransactionTraceDecor {
  constructor(readonly tran: Transaction) {}
  get color(): number { return 31 + (this.tran.id) % 6; }
  get prefix(): string { return `t${this.tran.id}`; }
  get margin(): number { return Dbg.trace.margin; }
}

export class Transaction {
  static readonly none: Transaction = new Transaction("none", SeparateFrom.All);
  static _current: Transaction;
  static _inspection: boolean = false;
  private readonly separate: SeparateFrom;
  private readonly snapshot: Snapshot; // assigned in constructor
  private workers: number = 0;
  private sealed: boolean = false;
  private error?: Error = undefined;
  private retryAfter?: Transaction = undefined;
  private resultPromise?: Promise<void> = undefined;
  private resultResolve: (value?: void) => void = undef;
  private resultReject: (reason: any) => void = undef;
  private conflicts?: Record[] = undefined;
  private reaction: { tran?: Transaction, effect: ICachedResult[] } = { tran: undefined, effect: [] };
  private readonly trace?: Partial<Trace>; // assigned in constructor
  private readonly decor: TransactionTraceDecor; // assigned in constructor

  constructor(hint: string, separate: SeparateFrom = SeparateFrom.Reaction, trace?: Partial<Trace>) {
    this.separate = separate;
    this.snapshot = new Snapshot(hint);
    this.trace = trace;
    this.decor = new TransactionTraceDecor(this);
  }

  static get current(): Transaction { return Transaction._current; }
  get id(): number { return this.snapshot.id; }
  get hint(): string { return this.snapshot.hint; }

  run<T>(func: F<T>, ...args: any[]): T {
    if (this.error) // prevent from continuing canceled transaction
      throw this.error;
    if (this.sealed && Transaction._current !== this)
      throw new Error("cannot run transaction that is already sealed");
    return this._run(func, ...args);
  }

  inspect<T>(func: F<T>, ...args: any[]): T {
    const restore = Transaction._inspection;
    try {
      Transaction._inspection = true;
      if (Dbg.trace.transactions) Dbg.log("", "  ", `transaction t${this.id} (${this.hint}) is being inspected by t${Transaction._current.id} (${Transaction._current.hint})`);
      return this._run(func, ...args);
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

  seal(): Transaction { // t.seal().waitForEnd().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(Transaction.seal, this);
    return this;
  }

  cancel(error: Error, retryAfterOrIgnore?: Transaction | null): Transaction {
    this._run(Transaction.seal, this, error,
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
    const hint = Dbg.trace.transactions ? `Tran#${this.snapshot.hint}.undo` : /* istanbul ignore next */ "noname";
    Transaction.runAs<void>(hint, SeparateFrom.Reaction, undefined, () => {
      this.snapshot.changeset.forEach((r: Record, h: Handle) => {
        r.changes.forEach(prop => {
          if (r.prev.backup) {
            const prevValue: any = r.prev.backup.data[prop];
            const t: Record = Snapshot.writable().tryWrite(h, prop, prevValue);
            if (t !== Record.empty) {
              t.data[prop] = prevValue;
              const v: any = t.prev.record.data[prop];
              Record.markChanged(t, prop, !Utils.equal(v, prevValue) /* && value !== RT_HANDLE*/, prevValue);
            }
          }
        });
      });
    });
  }

  static run<T>(func: F<T>, ...args: any[]): T {
    return Transaction.runAs("noname", SeparateFrom.Reaction, undefined, func, ...args);
  }

  static runAs<T>(hint: string, separate: SeparateFrom, trace: Partial<Trace> | undefined, func: F<T>, ...args: any[]): T {
    const t: Transaction = Transaction.acquire(hint, separate, trace);
    const root = t !== Transaction._current;
    let result: any = t.run<T>(func, ...args);
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

  private static acquire(hint: string, separate: SeparateFrom, trace: Partial<Trace> | undefined): Transaction {
    const spawn = Utils.hasAllFlags(separate, SeparateFrom.Parent)
      || Utils.hasAllFlags(Transaction._current.separate, SeparateFrom.Children)
      || Transaction._current.isFinished();
    return spawn ? new Transaction(hint, separate, trace) : Transaction._current;
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
        return Transaction.runAs<T>(this.hint, SeparateFrom.Reaction | SeparateFrom.Parent, this.trace, func, ...args);
      }
      else
        throw error;
    }
  }

  // Internal

  private _run<T>(func: F<T>, ...args: any[]): T {
    const outer = Transaction._current;
    const restore = Dbg.switch(this.trace, this.decor, Dbg.trace.transactions && (this.trace === undefined || this.trace.transactions !== false));
    let result: T;
    try {
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
    if (this.reaction.effect.length > 0) {
      try {
        Transaction.triggerRecacheAll(this.snapshot.hint,
          this.snapshot.timestamp, this.reaction, this.trace);
      }
      finally {
        if (!this.isFinished())
          this.reaction.effect = [];
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
    this.snapshot.complete();
    Snapshot.applyDependencies(this.snapshot.changeset, this.reaction.effect);
    this.snapshot.archive();
    if (this.resultPromise)
      this.resultResolve();
  }

  private performCancel(): void {
    this.snapshot.complete(this.error);
    this.snapshot.archive();
    if (this.resultPromise)
      if (!this.retryAfter)
        this.resultReject(this.error);
      else
        this.resultResolve();
  }

  static triggerRecacheAll(hint: string, timestamp: number, reaction: { tran?: Transaction, effect: ICachedResult[] }, trace?: Partial<Trace>): void {
    const name = Dbg.trace.transactions ? `${hint} - REACTION(${reaction.effect.length})` : /* istanbul ignore next */ "noname";
    const separate = reaction.tran ? SeparateFrom.Reaction : SeparateFrom.Reaction | SeparateFrom.Parent;
    Transaction.runAs<void>(name, separate, trace, () => {
      if (reaction.tran === undefined)
        reaction.tran = Transaction._current;
      reaction.effect.map(r => r.triggerRecache(timestamp, false));
    });
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

  static _wrap<T>(t: Transaction, c: ICachedResult | undefined, inc: boolean, dec: boolean, func: F<T>): F<T> {
    const inspect = Transaction._inspection;
    const f = c ? c.wrap(func) : func; // caching context
    const enter = inc ? function() { t.workers++; } : function() { /* nop */ };
    const leave = dec ? function(...args: any[]): T { if (dec) t.workers--; return f(...args); } : f;
    !inspect ? t.run(enter) : t.inspect(enter);
    const transactional: F<T> = (...args: any[]): T => {
      return !inspect ? t._run<T>(leave, ...args) : t.inspect<T>(leave, ...args);
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
    Transaction.none.sealed = true; // semi-hack
    Transaction.none.snapshot.complete();
    Transaction._current = Transaction.none;
    const empty = new Record(Record.empty, Transaction.none.snapshot, {});
    empty.prev.record = empty; // loopback
    empty.freeze();
    Utils.freezeMap(empty.observers);
    Utils.freezeMap(empty.outdated);
    Record.empty = empty;
  }
}

Transaction._init();
