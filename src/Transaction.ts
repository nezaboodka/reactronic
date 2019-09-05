import { Trace as T, Utils, undef, Record, ICachedResult, F, Handle, Snapshot, Hint } from "./internal/z.index";
import { SeparateFrom } from "./Config";

export class Transaction {
  static none: Transaction;
  static current: Transaction;
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
  private readonly tracing: number; // assigned in constructor

  constructor(hint: string, separate: SeparateFrom = SeparateFrom.Reaction, tracing: number = 0) {
    this.separate = separate;
    this.snapshot = new Snapshot(hint);
    this.tracing = tracing;
  }

  get id(): number { return this.snapshot.id; }
  get hint(): string { return this.snapshot.hint; }

  run<T>(func: F<T>, ...args: any[]): T {
    if (this.error) // prevent from continuing canceled transaction
      throw this.error;
    if (this.sealed && Transaction.current !== this)
      throw new Error("cannot run transaction that is already sealed");
    return this._run(func, ...args);
  }

  view<T>(func: F<T>, ...args: any[]): T {
    return this._run(func, ...args);
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
    const hint = T.level >= 2 ? `Tran#${this.snapshot.hint}.undo` : /* instabul ignore next */ "noname";
    Transaction.runAs<void>(hint, SeparateFrom.Reaction, 0, () => {
      this.snapshot.changeset.forEach((r: Record, h: Handle) => {
        r.changes.forEach(prop => {
          if (r.prev.backup) {
            const prevValue: any = r.prev.backup.data[prop];
            const t: Record = Snapshot.current().tryWrite(h, prop, prevValue);
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
    return Transaction.runAs("noname", SeparateFrom.Reaction, 0, func, ...args);
  }

  static runAs<T>(hint: string, separate: SeparateFrom, tracing: number, func: F<T>, ...args: any[]): T {
    const t: Transaction = Transaction.acquire(hint, separate, tracing);
    const root = t !== Transaction.current;
    let result: any;
    try {
      result = t.run<T>(func, ...args);
      if (root) {
        if (result instanceof Promise) {
          const outer = Transaction.current;
          try {
            Transaction.current = Transaction.none;
            result = t.autoretry(t.join(result), func, ...args);
          }
          finally {
            Transaction.current = outer;
          }
        }
        t.seal();
      }
    }
    catch (error) {
      t.cancel(error);
      throw error;
    }
    return result;
  }

  private static acquire(hint: string, separate: SeparateFrom, tracing: number): Transaction {
    const startNew = Utils.hasAllFlags(separate, SeparateFrom.Parent)
      || Utils.hasAllFlags(Transaction.current.separate, SeparateFrom.Children)
      || Transaction.current.isFinished();
    return startNew ? new Transaction(hint, separate, tracing) : Transaction.current;
  }

  private async autoretry<T>(p: Promise<T>, func: F<T>, ...args: any[]): Promise<T> {
    try {
      const result = await p;
      return result;
    }
    catch (error) {
      if (this.retryAfter && this.retryAfter !== Transaction.none) {
        if (T.level >= 2) T.log("", "  ", `transaction t${this.id} (${this.hint}) is waiting for restart`);
        await this.retryAfter.whenFinished(true);
        if (T.level >= 2) T.log("", "  ", `transaction t${this.id} (${this.hint}) is ready for restart`);
        return Transaction.runAs<T>(this.hint, SeparateFrom.Reaction | SeparateFrom.Parent, this.tracing, func, ...args);
      }
      else
        throw error;
    }
  }

  // Internal

  private _run<T>(func: F<T>, ...args: any[]): T {
    const outer = Transaction.current;
    const outerVerbosity = T.level;
    const outerColor = T.color;
    const outerPrefix = T.prefix;
    let result: T;
    try {
      this.workers++;
      Transaction.current = this;
      if (this.tracing !== 0)
        T.level = this.tracing;
      T.color = T.level >= 2 ? 31 + (this.snapshot.id) % 6 : 37;
      T.prefix = `t${this.id}`; // TODO: optimize to avoid toString
      this.snapshot.checkout();
      result = func(...args);
      if (this.sealed && this.workers === 1)
        if (!this.error)
          this.checkForConflicts();
        else if (!this.retryAfter)
          throw this.error;
    }
    catch (e) {
      this.error = this.error || e; // remember first error only
      throw e;
    }
    finally { // it's critical to have no exceptions in this block
      this.workers--;
      if (this.isFinished()) {
        !this.error ? this.performCommit() : this.performCancel();
        Object.freeze(this);
      }
      T.prefix = outerPrefix;
      T.color = outerColor;
      T.level = outerVerbosity;
      Transaction.current = outer;
    }
    if (this.reaction.effect.length > 0) {
      try {
        Transaction.triggerRecacheAll(this.snapshot.hint,
          this.snapshot.timestamp, this.reaction, this.tracing);
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
    this.snapshot.checkin();
    Snapshot.applyDependencies(this.snapshot.changeset, this.reaction.effect);
    this.snapshot.archive();
    if (this.resultPromise)
      this.resultResolve();
  }

  private performCancel(): void {
    this.snapshot.checkin(this.error);
    this.snapshot.archive();
    if (this.resultPromise)
      if (!this.retryAfter)
        this.resultReject(this.error);
      else
        this.resultResolve();
  }

  static triggerRecacheAll(hint: string, timestamp: number, reaction: { tran?: Transaction, effect: ICachedResult[] }, tracing: number = 0): void {
    const name = T.level >= 2 ? `${hint} - REACTION(${reaction.effect.length})` : /* istanbul ignore next */ "noname";
    const separate = reaction.tran ? SeparateFrom.Reaction : SeparateFrom.Reaction | SeparateFrom.Parent;
    Transaction.runAs<void>(name, separate, tracing, () => {
      if (reaction.tran === undefined)
        reaction.tran = Transaction.current;
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
    const f = c ? c.wrap(func) : func; // caching context
    if (inc)
      t.run<void>(() => t.workers++);
    const transactional: F<T> = (...args: any[]): T =>
      t._run<T>(() => { // transaction context
        if (dec)
          t.workers--;
        return f(...args);
      });
    return transactional;
  }

  static _getActiveSnapshot(): Snapshot {
    return Transaction.current.snapshot;
  }

  static _init(): void {
    const none = new Transaction("none", SeparateFrom.All, 0);
    none.sealed = true;
    none.snapshot.checkin();
    Transaction.none = none;
    Transaction.current = none;
    const empty = new Record(Record.empty, none.snapshot, {});
    empty.prev.record = empty; // loopback
    empty.freeze();
    Utils.freezeMap(empty.observers);
    Utils.freezeSet(empty.outdated);
    Record.empty = empty;
  }
}
