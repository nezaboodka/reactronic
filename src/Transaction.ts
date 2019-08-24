import { Debug, Utils, undef, Record, ICache, F, Handle, Snapshot, Hint } from "./internal/z.index";

export class Transaction {
  static head: Transaction;
  static active: Transaction;
  private readonly snapshot: Snapshot; // assigned in constructor
  tracing: number; // assigned in constructor
  private busy: number = 0;
  private sealed: boolean = false;
  private error: Error | undefined = undefined;
  private resultPromise?: Promise<void> = undefined;
  private resultResolve: (value?: void) => void = undef;
  private resultReject: (reason: any) => void = undef;
  private conflicts?: Record[] = undefined;
  private reaction: { tran?: Transaction, effect: ICache[] } = { tran: undefined, effect: [] };

  constructor(hint: string, tracing: number = 0) {
    this.snapshot = new Snapshot(hint);
    this.tracing = tracing;
  }

  get id(): number { return this.snapshot.id; }
  get hint(): string { return this.snapshot.hint; }

  run<T>(func: F<T>, ...args: any[]): T {
    if (this.sealed && Transaction.active !== this)
      throw new Error("E601: cannot run sealed transaction");
    return this._run(func, ...args);
  }

  view<T>(func: F<T>, ...args: any[]): T {
    return this._run(func, ...args);
  }

  // wrap<T>(func: F<T>): F<T> {
  //   return Transaction._wrap<T>(this, Ctx.reaction, true, true, func);
  // }

  commit(): void {
    if (this.busy > 0)
      throw new Error("E602: cannot commit transaction having pending async operations");
    if (this.error)
      throw new Error(`E603: cannot commit discarded transaction: ${this.error}`);
    this.seal(); // commit immediately, because pending === 0
  }

  seal(): Transaction { // t.seal().waitForEnd().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(Transaction.seal, this);
    return this;
  }

  reject(error: Error): Transaction {
    if (!this.error)
      this.error = error;
    if (!this.sealed)
      this.run(Transaction.seal, this);
    return this;
  }

  cancel(): Transaction {
    return this.reject(new TransactionCanceled(this));
  }

  finished(): boolean {
    return this.sealed && this.busy === 0;
  }

  async whenFinished(includingReactions: boolean): Promise<void> {
    if (!this.finished())
      await this.acquirePromise();
    if (includingReactions && this.reaction.tran)
      await this.reaction.tran.whenFinished(true);
  }

  async restartAfter(after: Transaction): Promise<void> {
    throw new TransactionCanceled(this, after);
  }

  undo(): void {
    let hint = Debug.verbosity >= 2 ? `Tran#${this.snapshot.hint}.undo` : "noname";
    Transaction.runAs<void>(hint, false, 0, () => {
      this.snapshot.changeset.forEach((r: Record, h: Handle) => {
        r.edits.forEach(prop => {
          if (r.prev.backup) {
            let prevValue: any = r.prev.backup.data[prop];
            let t: Record = Snapshot.active().tryEdit(h, prop, prevValue);
            if (t !== Record.empty) {
              t.data[prop] = prevValue;
              let v: any = t.prev.record.data[prop];
              Record.markEdited(t, prop, !Utils.equal(v, prevValue) /* && value !== RT_HANDLE*/, prevValue);
            }
          }
        });
      });
    });
  }

  static run<T>(func: F<T>, ...args: any[]): T {
    return Transaction.runAs("noname", false, 0, func, ...args);
  }

  static runAs<T>(hint: string, root: boolean, verbosity: number, func: F<T>, ...args: any[]): T {
    let inception = root || Transaction.active.finished();
    let t: Transaction = inception ? new Transaction(hint, verbosity) : Transaction.active;
    root = t !== Transaction.active;
    let result: any;
    try {
      result = t.run<T>(func, ...args);
      if (root) {
        if (result instanceof Promise) {
          let outer = Transaction.active;
          try {
            Transaction.active = Transaction.head;
            result = t.whenFinishedThen<T>(result, func, ...args);
          }
          finally {
            Transaction.active = outer;
          }
        }
        t.seal();
      }
    }
    catch (error) {
      t.reject(error);
      throw error;
    }
    if (t.error && !(t.error instanceof TransactionCanceled))
      throw t.error;
    return result;
  }

  async whenFinishedThen<T>(p: Promise<T>, func: F<T>, ...args: any[]): Promise<T> {
    let result: T;
    try {
      result = await p;
      await this.whenFinished(false);
    }
    catch (error) {
      if (error instanceof TransactionCanceled && error.restartAfter) {
        if (Debug.verbosity >= 2) Debug.log("", "  ", `transaction t${this.id}'${this.hint} is waiting for restart`);
        await error.restartAfter.whenFinished(true);
        if (Debug.verbosity >= 2) Debug.log("", "  ", `transaction t${this.id}'${this.hint} is restarted`);
        result = Transaction.runAs<T>(this.hint, true, this.tracing, func, ...args);
      }
      else
        throw error;
    }
    // (result as any)[RT_UNMOUNT] = `wrapped-when-finished: t${this.id}'${this.hint}`;
    return result; // return only when transaction is finished
  }

  // Internal

  private _run<T>(func: F<T>, ...args: any[]): T {
    const outer = Transaction.active;
    const outerVerbosity = Debug.verbosity;
    const outerColor = Debug.color;
    const outerPrefix = Debug.prefix;
    let result: T;
    try {
      this.busy++;
      Transaction.active = this;
      if (this.tracing !== 0)
        Debug.verbosity = this.tracing;
      if (Debug.verbosity >= 2)
        Debug.color = 31 + (this.snapshot.id) % 6;
      else
        Debug.color = 37;
      // Debug.color = 31 + (this.snapshot.id) % 6;
      Debug.prefix = `t${this.snapshot.id}`; // TODO: optimize to avoid toString
      this.snapshot.checkout();
      result = func(...args);
      if (this.sealed && this.busy === 1 && !this.error)
        this.checkForConflicts();
    }
    catch (e) {
      this.error = this.error || e; // remember first error only
      throw e;
    }
    finally { // it's critical to have no exceptions in this block
      this.busy--;
      if (this.finished()) {
        !this.error ? this.performCommit() : this.performDiscard();
        Object.freeze(this);
      }
      Debug.prefix = outerPrefix;
      Debug.color = outerColor;
      Debug.verbosity = outerVerbosity;
      Transaction.active = outer;
    }
    if (this.reaction.effect.length > 0) {
      try {
        Transaction.triggerRecacheAll(this.snapshot.hint,
          this.snapshot.timestamp, this.reaction, this.tracing);
      }
      finally {
        if (!this.finished())
          this.reaction.effect = [];
      }
    }
    return result;
  }

  private static seal(t: Transaction): void {
    t.sealed = true;
  }

  private checkForConflicts(): void {
    this.conflicts = this.snapshot.rebase();
    if (this.conflicts)
      this.tryResolveConflicts(this.conflicts);
  }

  private tryResolveConflicts(conflicts: Record[]): void {
    this.error = this.error || new Error(`t${this.snapshot.id}'${this.snapshot.hint} conflicts with other transactions on: ${Hint.conflicts(conflicts)}`);
    // this.error = this.error || RT_NO_THROW; // silently ignore conflicting transactions
  }

  private performCommit(): void {
    this.snapshot.checkin();
    Snapshot.applyDependencies(this.snapshot.changeset, this.reaction.effect);
    this.snapshot.archive();
    if (this.resultPromise)
      this.resultResolve();
  }

  private performDiscard(): void {
    this.snapshot.checkin(this.error);
    this.snapshot.archive();
    if (this.resultPromise)
      if (this.error instanceof TransactionCanceled)
        this.resultResolve();
      else
        this.resultReject(this.error);
  }

  static triggerRecacheAll(hint: string, timestamp: number, reaction: { tran?: Transaction, effect: ICache[] }, tracing: number = 0): void {
    let name = Debug.verbosity >= 2 ? `${hint} - REACTION(${reaction.effect.length})` : "noname";
    Transaction.runAs<void>(name, reaction.tran === undefined, tracing, () => {
      if (reaction.tran === undefined)
        reaction.tran = Transaction.active;
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

  static _wrap<T>(t: Transaction, c: ICache | undefined, inc: boolean, dec: boolean, func: F<T>): F<T> {
    let f = c ? c.wrap(func) : func; // caching context
    if (inc)
      t.run<void>(() => t.busy++);
    let tran: F<T> = (...args: any[]): T =>
      t._run<T>(() => { // transaction context
        if (dec)
          t.busy--;
        // if (t.sealed && t.error)
        //   throw t.error;
        return f(...args);
      });
    return tran;
  }

  static _getActiveSnapshot(): Snapshot {
    return Transaction.active.snapshot;
  }

  static _init(): void {
    let head = new Transaction("head");
    head.sealed = true;
    head.snapshot.checkin();
    Transaction.head = head;
    Transaction.active = head;
    let empty = new Record(Record.empty, head.snapshot, {});
    empty.prev.record = empty; // loopback
    empty.freeze();
    Utils.freezeMap(empty.observers);
    Utils.freezeSet(empty.outdated);
    Record.empty = empty;
  }
}

class TransactionCanceled extends Error {
  constructor(readonly tran: Transaction, readonly restartAfter?: Transaction) {
    super(`transaction ${tran.id}/${tran.hint} is canceled and will be ${restartAfter ? `restarted after ${restartAfter.id}/${restartAfter.hint}` : `ignored`}`);
    Object.setPrototypeOf(this, TransactionCanceled.prototype);
    // https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
  }
}
