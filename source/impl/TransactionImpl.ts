// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { undef, F } from '../util/Utils'
import { Dbg, misuse, error } from '../util/Dbg'
import { Record } from './Data'
import { Snapshot, Hints } from './Snapshot'
import { Worker } from '../Monitor'
import { Transaction } from '../Transaction'
import { LoggingOptions } from '../Options'

export class TransactionImpl extends Transaction {
  private static readonly none: TransactionImpl = new TransactionImpl('<none>')
  private static running: TransactionImpl = TransactionImpl.none
  private static inspection: boolean = false

  readonly logging?: Partial<LoggingOptions> // assigned in constructor
  readonly margin: number
  private readonly snapshot: Snapshot // assigned in constructor
  private workers: number
  private sealed: boolean
  private canceled?: Error
  private after?: TransactionImpl
  private promise?: Promise<void>
  private resolve: (value?: void) => void
  private reject: (reason: any) => void

  constructor(hint: string, logging?: Partial<LoggingOptions>, token?: any) {
    super()
    this.logging = logging
    this.margin = TransactionImpl.running ? TransactionImpl.running.margin + 1 : -1
    this.snapshot = new Snapshot(hint, token)
    this.workers = 0
    this.sealed = false
    this.canceled = undefined
    this.after = undefined
    this.promise = undefined
    this.resolve = undef
    this.reject = undef
  }

  static get current(): TransactionImpl { return TransactionImpl.running }
  get id(): number { return this.snapshot.id }
  get hint(): string { return this.snapshot.hint }
  get error(): Error | undefined { return this.canceled }

  run<T>(func: F<T>, ...args: any[]): T {
    this.guard()
    return this.do(undefined, func, ...args)
  }

  inspect<T>(func: F<T>, ...args: any[]): T {
    const restore = TransactionImpl.inspection
    try {
      TransactionImpl.inspection = true
      if (Dbg.isOn && Dbg.logging.transactions)
        Dbg.log(' ', ' ', `T${this.id} (${this.hint}) is being inspected by T${TransactionImpl.running.id} (${TransactionImpl.running.hint})`)
      return this.do(undefined, func, ...args)
    }
    finally {
      TransactionImpl.inspection = restore
    }
  }

  apply(): void {
    if (this.workers > 0)
      throw misuse('cannot apply transaction having active functions running')
    if (this.canceled)
      throw misuse(`cannot apply transaction that is already canceled: ${this.canceled}`)
    this.seal() // apply immediately, because pending === 0
  }

  seal(): this { // t1.seal().whenFinished().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(TransactionImpl.seal, this)
    return this
  }

  bind<T>(func: F<T>, error: boolean): F<T> {
    this.guard()
    const self = this
    const inspect = TransactionImpl.inspection
    if (!inspect)
      self.run(TransactionImpl.boundEnter, self, error)
    else
      self.inspect(TransactionImpl.boundEnter, self, error)
    const transactionBound: F<T> = (...args: any[]): T => {
      if (!inspect)
        return self.do<T>(undefined, TransactionImpl.boundLeave, self, error, func, ...args)
      else
        return self.inspect<T>(TransactionImpl.boundLeave, self, error, func, ...args)
    }
    return transactionBound
  }

  private static boundEnter<T>(t: TransactionImpl, error: boolean): void {
    if (!error)
      t.workers++
  }

  private static boundLeave<T>(t: TransactionImpl, error: boolean, func: F<T>, ...args: any[]): T {
    t.workers--
    const result = func(...args)
    // if (t.error && !error)
    //   throw t.error
    return result
  }

  cancel(error: Error, restartAfter?: Worker | null): this {
    this.do(undefined, TransactionImpl.seal, this, error,
      restartAfter === null ? TransactionImpl.none : restartAfter)
    return this
  }

  get isCanceled(): boolean {
    return this.canceled !== undefined
  }

  get isFinished(): boolean {
    return this.sealed && this.workers === 0
  }

  async whenFinished(): Promise<void> {
    if (!this.isFinished)
      await this.acquirePromise()
  }

  static run<T>(hint: string, func: F<T>, ...args: any[]): T {
    return TransactionImpl.runAs<T>(hint, false, undefined, undefined, func, ...args)
  }

  static runAs<T>(hint: string, spawn: boolean, logging: Partial<LoggingOptions> | undefined, token: any, func: F<T>, ...args: any[]): T {
    const t: TransactionImpl = TransactionImpl.acquire(hint, spawn, logging, token)
    const root = t !== TransactionImpl.running
    t.guard()
    let result: any = t.do<T>(logging, func, ...args)
    if (root) {
      if (result instanceof Promise)
        result = TransactionImpl.isolated(() => {
          return t.wrapToRetry(t.wrapToWaitUntilFinish(result), func, ...args)
        })
      t.seal()
    }
    return result
  }

  static isolated<T>(func: F<T>, ...args: any[]): T {
    const outer = TransactionImpl.running
    try {
      TransactionImpl.running = TransactionImpl.none
      return func(...args)
    }
    finally {
      TransactionImpl.running = outer
    }
  }

  // Internal

  private static acquire(hint: string, spawn: boolean, logging: Partial<LoggingOptions> | undefined, token: any): TransactionImpl {
    return spawn || TransactionImpl.running.isFinished
      ? new TransactionImpl(hint, logging, token)
      : TransactionImpl.running
  }

  private guard(): void {
    // if (this.error) // prevent from continuing canceled transaction
    //   throw error(this.error.message, this.error)
    if (this.sealed && TransactionImpl.running !== this)
      throw misuse('cannot run transaction that is already sealed')
  }

  private async wrapToRetry<T>(p: Promise<T>, func: F<T>, ...args: any[]): Promise<T | undefined> {
    try {
      const result = await p
      if (this.canceled)
        throw this.canceled
      return result
    }
    catch (error) {
      if (this.after !== TransactionImpl.none) {
        if (this.after) {
          // if (Dbg.logging.actions) Dbg.log("", "  ", `T${this.id} (${this.hint}) is waiting for restart`)
          // if (this.after !== this)
          //   await this.after.whenFinished()
          await this.after.whenFinished()
          // if (Dbg.logging.actions) Dbg.log("", "  ", `T${this.id} (${this.hint}) is ready for restart`)
          return TransactionImpl.runAs<T>(this.hint, true, this.logging, this.snapshot.token, func, ...args)
        }
        else
          throw error
      }
      else
        return undefined
    }
  }

  private async wrapToWaitUntilFinish<T>(p: Promise<T>): Promise<T> {
    const result = await p
    await this.whenFinished()
    return result
  }

  // Internal

  private do<T>(logging: Partial<LoggingOptions> | undefined, func: F<T>, ...args: any[]): T {
    let result: T
    const outer = TransactionImpl.running
    try {
      TransactionImpl.running = this
      this.workers++
      this.snapshot.acquire(outer.snapshot)
      result = func(...args)
      if (this.sealed && this.workers === 1) {
        if (!this.canceled)
          this.checkForConflicts() // merge with concurrent actions
        else if (!this.after)
          throw this.canceled
      }
    }
    catch (e) {
      if (!TransactionImpl.inspection)
        this.cancel(e)
      throw e
    }
    finally { // it's critical to have no exceptions in this block
      this.workers--
      if (this.sealed && this.workers === 0) {
        this.finish()
        TransactionImpl.running = outer
        if (!this.canceled)
          TransactionImpl.isolated(TransactionImpl.revalidateTriggers, this)
      }
      else
        TransactionImpl.running = outer
    }
    return result
  }

  private static revalidateTriggers(t: TransactionImpl): void {
    t.snapshot.triggers.map(x => x.revalidate(false, true))
  }

  private static seal(t: TransactionImpl, error?: Error, after?: TransactionImpl): void {
    if (!t.canceled && error) {
      t.canceled = error
      t.after = after
      if (Dbg.isOn && Dbg.logging.transactions) {
        Dbg.log('║', ' [!]', `${error.message}`, undefined, ' *** CANCEL ***')
        if (after && after !== TransactionImpl.none)
          Dbg.log('║', ' [!]', `T${t.id} (${t.hint}) will be restarted after T${after.id} (${after.hint})`)
      }
      Snapshot.finalizeChangeset(t.snapshot, error)
    }
    t.sealed = true
  }

  private checkForConflicts(): void {
    const conflicts = this.snapshot.rebase()
    if (conflicts)
      this.tryResolveConflicts(conflicts)
  }

  private tryResolveConflicts(conflicts: Record[]): void {
    throw error(`T${this.id} (${this.hint}) conflicts with: ${Hints.conflicts(conflicts)}`, undefined)
  }

  private finish(): void {
    // It's critical to have no exceptions in this block
    this.snapshot.complete(this.canceled)
    this.snapshot.collect()
    if (this.promise) {
      if (this.canceled && !this.after)
        this.reject(this.canceled)
      else
        this.resolve()
    }
    if (Dbg.isOn)
      Object.freeze(this)
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
    return TransactionImpl.running.snapshot
  }

  private static writableSnapshot(): Snapshot {
    if (TransactionImpl.inspection)
      throw misuse('cannot make changes during transaction inspection')
    return TransactionImpl.running.snapshot
  }

  static _init(): void {
    Snapshot.readable = TransactionImpl.readableSnapshot // override
    Snapshot.writable = TransactionImpl.writableSnapshot // override
    TransactionImpl.none.sealed = true
    TransactionImpl.none.snapshot.complete()
    Snapshot._init()
  }
}

TransactionImpl._init()
