// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg, misuse, error, undef, Record, ICacheResult, F, Snapshot, Hint } from '../internal/all'
import { Trace } from './Config'

export class Transaction {
  static readonly none: Transaction = new Transaction("<none>")
  static readonly init: Transaction = new Transaction("<init>")
  static _current: Transaction
  static _inspection: boolean = false

  readonly trace?: Partial<Trace> // assigned in constructor
  readonly margin: number
  private readonly snapshot: Snapshot // assigned in constructor
  private readonly sidebyside: boolean
  private workers: number
  private sealed: boolean
  private error?: Error
  private retryAfter?: Transaction
  private promise?: Promise<void>
  private resolve: (value?: void) => void
  private reject: (reason: any) => void
  private readonly reaction: { tran?: Transaction }

  constructor(hint: string, sidebyside: boolean = false, trace?: Partial<Trace>, token?: any) {
    this.trace = trace
    this.margin = Transaction._current ? Transaction._current.margin + 1 : -1
    this.snapshot = new Snapshot(hint, token)
    this.sidebyside = sidebyside
    this.workers = 0
    this.sealed = false
    this.error = undefined
    this.retryAfter = undefined
    this.promise = undefined
    this.resolve = undef
    this.reject = undef
    this.reaction = { tran: undefined }
  }

  static get current(): Transaction { return Transaction._current }
  get id(): number { return this.snapshot.id }
  get hint(): string { return this.snapshot.hint }

  run<T>(func: F<T>, ...args: any[]): T {
    this.guard()
    return this.do(undefined, func, ...args)
  }

  inspect<T>(func: F<T>, ...args: any[]): T {
    const restore = Transaction._inspection
    try {
      Transaction._inspection = true
      if (Dbg.isOn && Dbg.trace.transactions) Dbg.log("", "  ", `transaction T${this.id} (${this.hint}) is being inspected by T${Transaction._current.id} (${Transaction._current.hint})`)
      return this.do(undefined, func, ...args)
    }
    finally {
      Transaction._inspection = restore
    }
  }

  commit(): void {
    if (this.workers > 0)
      throw misuse("cannot commit transaction having active workers")
    if (this.error)
      throw misuse(`cannot commit transaction that is already canceled: ${this.error}`)
    this.seal() // commit immediately, because pending === 0
  }

  seal(): this { // t.seal().whenFinished().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(Transaction.seal, this)
    return this
  }

  bind<T>(func: F<T>, secondary: boolean = false): F<T> {
    this.guard()
    const self = this
    const inspect = Transaction._inspection
    const enter = !secondary ? function(): void { self.workers++ } : function(): void { /* nop */ }
    const leave = function(...args: any[]): T { self.workers--; return func(...args) }
    !inspect ? self.do(undefined, enter) : self.inspect(enter)
    const fTransactionDo: F<T> = (...args: any[]): T => {
      return !inspect ? self.do<T>(undefined, leave, ...args) : self.inspect<T>(leave, ...args)
    }
    return fTransactionDo
  }

  cancel(error: Error, retryAfterOrIgnore?: Transaction | null): this {
    this.do(undefined, Transaction.seal, this, error,
      retryAfterOrIgnore === null ? Transaction.none : retryAfterOrIgnore)
    return this
  }

  isCanceled(): boolean {
    return this.error !== undefined
  }

  isFinished(): boolean {
    return this.sealed && this.workers === 0
  }

  async whenFinished(includingReaction: boolean): Promise<void> {
    if (!this.isFinished())
      await this.acquirePromise()
    if (includingReaction && this.reaction.tran)
      await this.reaction.tran.whenFinished(true)
  }

  // undo(): void {
  //   const hint = Dbg.isOn ? `Tran#${this.snapshot.hint}.undo` : /* istanbul ignore next */ "noname";
  //   Transaction.runAs(hint, false, undefined, undefined,
  //     Snapshot.undo, this.snapshot);
  // }

  static run<T>(hint: string, func: F<T>, ...args: any[]): T {
    return Transaction.runAs(hint, false, false, undefined, undefined, func, ...args)
  }

  static runAs<T>(hint: string, spawn: boolean, sidebyside: boolean, trace: Partial<Trace> | undefined, token: any, func: F<T>, ...args: any[]): T {
    const t: Transaction = Transaction.acquire(hint, spawn, sidebyside, trace, token)
    const root = t !== Transaction._current
    t.guard()
    let result: any = t.do<T>(trace, func, ...args)
    if (root) {
      if (result instanceof Promise)
        result = Transaction.outside(() => {
          return t.wrapToRetry(t.postponed(result), func, ...args)
        })
      t.seal()
    }
    return result
  }

  static outside<T>(func: F<T>, ...args: any[]): T {
    const outer = Transaction._current
    try {
      Transaction._current = Transaction.none
      return func(...args)
    }
    finally {
      Transaction._current = outer
    }
  }

  // Internal

  private static acquire(hint: string, spawn: boolean, sidebyside: boolean, trace: Partial<Trace> | undefined, token: any): Transaction {
    return spawn || Transaction._current.isFinished()
      ? new Transaction(hint, sidebyside, trace, token)
      : Transaction._current
  }

  private guard(): void {
    if (this.error) // prevent from continuing canceled transaction
      throw this.error
    if (this.sealed && Transaction._current !== this)
      throw misuse("cannot run transaction that is already sealed")
  }

  private async wrapToRetry<T>(p: Promise<T>, func: F<T>, ...args: any[]): Promise<T> {
    try {
      const result = await p
      return result
    }
    catch (error) {
      if (this.retryAfter && this.retryAfter !== Transaction.none) {
        // if (Dbg.trace.transactions) Dbg.log("", "  ", `transaction T${this.id} (${this.hint}) is waiting for restart`)
        await this.retryAfter.whenFinished(true)
        // if (Dbg.trace.transactions) Dbg.log("", "  ", `transaction T${this.id} (${this.hint}) is ready for restart`)
        return Transaction.runAs<T>(this.hint, true, this.sidebyside, this.trace, this.snapshot.caching, func, ...args)
      }
      else
        throw error
    }
  }

  private async postponed<T>(p: Promise<T>): Promise<T> {
    const result = await p
    await this.whenFinished(false)
    return result
  }

  // Internal

  private do<T>(trace: Partial<Trace> | undefined, func: F<T>, ...args: any[]): T {
    let result: T
    const outer = Transaction._current
    try {
      this.workers++
      Transaction._current = this
      this.snapshot.acquire(outer.snapshot)
      result = func(...args)
      if (this.sealed && this.workers === 1) {
        if (!this.error)
          this.checkForConflicts() // merge with concurrent transactions
        else if (!this.retryAfter)
          throw this.error
      }
    }
    catch (e) {
      if (!Transaction._inspection)
        this.cancel(e)
      throw e
    }
    finally { // it's critical to have no exceptions in this block
      this.workers--
      if (this.sealed && this.workers === 0) {
        !this.error ? this.performCommit() : this.performCancel()
        Object.freeze(this)
      }
      if (this.snapshot.triggers.length > 0)
        this.runTriggers()
      Transaction._current = outer
    }
    return result
  }

  private runTriggers(): void {
    const hint = Dbg.isOn ? `■-■-■ TRIGGERS(${this.snapshot.triggers.length}) after T${this.id} (${this.snapshot.hint})` : /* istanbul ignore next */ "TRIGGERS"
    this.reaction.tran = Transaction.runAs(hint, true, false, this.trace, undefined,
      Transaction.runTriggersFunc, this.snapshot.triggers)
  }

  private static runTriggersFunc(triggers: ICacheResult[]): Transaction {
    const timestamp = Transaction.current.snapshot.timestamp
    triggers.map(t => t.trig(timestamp, false, false))
    return Transaction.current
  }

  private static seal(t: Transaction, error?: Error, retryAfter?: Transaction): void {
    if (!t.error && error) {
      t.error = error
      t.retryAfter = retryAfter
      if (Dbg.isOn && Dbg.trace.errors && retryAfter === undefined) Dbg.log("║", "!", `${error.message}`, undefined, " *** ERROR ***")
    }
    t.sealed = true
  }

  private checkForConflicts(): void {
    const conflicts = this.snapshot.rebase()
    if (conflicts)
      this.tryResolveConflicts(conflicts)
  }

  private tryResolveConflicts(conflicts: Record[]): void {
    if (!this.sidebyside) {
      this.error = this.error || error(`transaction T${this.id} (${this.hint}) conflicts with: ${Hint.conflicts(conflicts)}`)
      throw this.error
    } // ignore conflicts otherwise
  }

  private performCommit(): void {
    this.snapshot.apply()
    this.snapshot.archive()
    if (this.promise)
      this.resolve()
  }

  private performCancel(): void {
    this.snapshot.apply(this.error)
    this.snapshot.archive()
    if (this.promise)
      if (!this.retryAfter)
        this.reject(this.error)
      else
        this.resolve()
  }

  private acquirePromise(): Promise<void> {
    if (!this.promise) {
      this.promise = new Promise((resolve, reject): void => {
        this.resolve = resolve
        this.reject = reject
      })
    }
    return this.promise
  }

  private static readableSnapshot(): Snapshot {
    return Transaction._current.snapshot
  }

  private static writableSnapshot(): Snapshot {
    if (Transaction._inspection)
      throw misuse("cannot make changes during transaction inspection")
    return Transaction._current.snapshot
  }

  static _init(): void {
    Snapshot.readable = Transaction.readableSnapshot // override
    Snapshot.writable = Transaction.writableSnapshot // override
    Transaction.none.sealed = true
    Transaction.none.snapshot.apply()
    Transaction.init.snapshot.acquire(Transaction.init.snapshot)
    Transaction.init.sealed = true
    Transaction.init.snapshot.apply()
    Transaction._current = Transaction.none
    const blank = new Record(Record.blank, Transaction.init.snapshot, {})
    blank.prev.record = blank // loopback
    blank.freeze()
    Record.blank = blank
    Snapshot.lastId = 100
    Snapshot.headStamp = 101
    Snapshot.oldest = undefined
  }
}

Transaction._init()
