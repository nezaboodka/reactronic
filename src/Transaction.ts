import { Debug, Utils, undef, Record, ICachedResult, F, Handle, Snapshot, Hint } from "./internal/z.index";
import { SeparateFrom } from "./Config";

export class Transaction {
  static nope: Transaction;
  static active: Transaction;
  private readonly separate: SeparateFrom;
  private readonly snapshot: Snapshot; // assigned in constructor
  private busy: number = 0;
  private sealed: boolean = false;
  private error?: Error = undefined;
  private awaiting?: Transaction = undefined;
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
    if (this.sealed && Transaction.active !== this)
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
    if (this.busy > 0)
      throw new Error("cannot commit transaction having pending async operations");
    if (this.error)
      throw new Error(`cannot commit transaction that is already discarded: ${this.error}`);
    this.seal(); // commit immediately, because pending === 0
  }

  seal(): Transaction { // t.seal().waitForEnd().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(Transaction.seal, this);
    return this;
  }

  discard(error: Error = RT_IGNORE, retryAfter: Transaction = Transaction.nope): Transaction {
    if (!this.error) {
      this.error = error;
      this.awaiting = retryAfter;
    }
    if (!this.sealed)
      this.run(Transaction.seal, this);
    return this;
  }

  discarded(): boolean {
    return this.error !== undefined;
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

  async join<T>(p: Promise<T>): Promise<T> {
    const result = await p;
    await this.whenFinished(false);
    return result;
  }

  undo(): void {
    const hint = Debug.verbosity >= 2 ? `Tran#${this.snapshot.hint}.undo` : "noname";
    Transaction.runAs<void>(hint, SeparateFrom.Reaction, 0, () => {
      this.snapshot.changeset.forEach((r: Record, h: Handle) => {
        r.edits.forEach(prop => {
          if (r.prev.backup) {
            const prevValue: any = r.prev.backup.data[prop];
            const t: Record = Snapshot.active().tryEdit(h, prop, prevValue);
            if (t !== Record.empty) {
              t.data[prop] = prevValue;
              const v: any = t.prev.record.data[prop];
              Record.markEdited(t, prop, !Utils.equal(v, prevValue) /* && value !== RT_HANDLE*/, prevValue);
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
    const root = t !== Transaction.active;
    let result: any;
    try {
      result = t.run<T>(func, ...args);
      if (root) {
        if (result instanceof Promise) {
          const outer = Transaction.active;
          try {
            Transaction.active = Transaction.nope;
            result = t.retryIfNeeded(t.join(result), func, ...args);
          }
          finally {
            Transaction.active = outer;
          }
        }
        t.seal();
      }
    }
    catch (error) {
      t.discard(error);
      throw error;
    }
    if (t.error && !t.awaiting)
      throw t.error;
    return result;
  }

  private static acquire(hint: string, separate: SeparateFrom, tracing: number): Transaction {
    const startNew = Utils.hasAllFlags(separate, SeparateFrom.Parent)
      || Utils.hasAllFlags(Transaction.active.separate, SeparateFrom.Children)
      || Transaction.active.finished();
    return startNew ? new Transaction(hint, separate, tracing) : Transaction.active;
  }

  private async retryIfNeeded<T>(p: Promise<T>, func: F<T>, ...args: any[]): Promise<T> {
    try {
      const result = await p;
      return result;
    }
    catch (error) {
      if (this.awaiting && this.awaiting !== Transaction.nope) {
        if (Debug.verbosity >= 2) Debug.log("", "  ", `transaction t${this.id} (${this.hint}) is waiting for restart`);
        await this.awaiting.whenFinished(true);
        if (Debug.verbosity >= 2) Debug.log("", "  ", `transaction t${this.id} (${this.hint}) is ready for restart`);
        return Transaction.runAs<T>(this.hint, SeparateFrom.Reaction | SeparateFrom.Parent, this.tracing, func, ...args);
      }
      else
        throw error;
    }
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
      Debug.color = Debug.verbosity >= 2 ? 31 + (this.snapshot.id) % 6 : 37;
      Debug.prefix = `t${this.id}`; // TODO: optimize to avoid toString
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

  private performDiscard(): void {
    this.snapshot.checkin(this.error);
    this.snapshot.archive();
    if (this.resultPromise)
      if (this.error !== RT_IGNORE)
        this.resultReject(this.error);
      else
        this.resultResolve();
  }

  static triggerRecacheAll(hint: string, timestamp: number, reaction: { tran?: Transaction, effect: ICachedResult[] }, tracing: number = 0): void {
    const name = Debug.verbosity >= 2 ? `${hint} - REACTION(${reaction.effect.length})` : "noname";
    const separate = reaction.tran ? SeparateFrom.Reaction : SeparateFrom.Reaction | SeparateFrom.Parent;
    Transaction.runAs<void>(name, separate, tracing, () => {
      if (reaction.tran === undefined)
        reaction.tran = Transaction.active;
      reaction.effect.map(r => r.triggerRecache(timestamp, false, undefined));
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
      t.run<void>(() => t.busy++);
    const tran: F<T> = (...args: any[]): T =>
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
    const nope = new Transaction("nope", SeparateFrom.All, 0);
    nope.sealed = true;
    nope.snapshot.checkin();
    Transaction.nope = nope;
    Transaction.active = nope;
    const empty = new Record(Record.empty, nope.snapshot, {});
    empty.prev.record = empty; // loopback
    empty.freeze();
    Utils.freezeMap(empty.observers);
    Utils.freezeSet(empty.outdated);
    Record.empty = empty;
  }
}

const RT_IGNORE = new Error("transaction is discarded and will be silently ignored");
