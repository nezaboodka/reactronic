// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { UNDEF, F, pause } from '../util/Utils'
import { Log, misuse, error, fatal } from '../util/Dbg'
import { Worker } from '../Worker'
import { SnapshotOptions, LoggingOptions } from '../Options'
import { ObjectSnapshot, Observer } from './Data'
import { Changeset, Dump } from './Changeset'

export abstract class Transaction implements Worker {
  static get current(): Transaction { return TransactionImpl.current }

  abstract readonly id: number
  abstract readonly hint: string
  abstract readonly options: SnapshotOptions
  abstract readonly timestamp: number
  abstract readonly error: Error | undefined
  abstract readonly changeset: Changeset
  abstract readonly margin: number

  abstract run<T>(func: F<T>, ...args: any[]): T
  abstract inspect<T>(func: F<T>, ...args: any[]): T
  abstract apply(): void
  abstract seal(): this
  abstract wrap<T>(func: F<T>, secondary: boolean): F<T>
  abstract cancel(error: Error, retryAfterOrIgnore?: Worker | null): this
  abstract readonly isCanceled: boolean
  abstract readonly isFinished: boolean
  async whenFinished(): Promise<void> { /* to be overridden */ }

  static create(options: SnapshotOptions | null): Transaction { return new TransactionImpl(options) }
  static run<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T { return TransactionImpl.run<T>(options, func, ...args) }
  static separate<T>(func: F<T>, ...args: any[]): T { return TransactionImpl.separate(func, ...args) }
  static outside<T>(func: F<T>, ...args: any[]): T { return TransactionImpl.outside<T>(func, ...args) }

  static isFrameOver(everyN: number = 1, timeLimit: number = 10): boolean { return TransactionImpl.isFrameOver(everyN, timeLimit) }
  static requestNextFrame(sleepTime: number = 0): Promise<void> { return TransactionImpl.requestNextFrame(sleepTime) }
  static get isCanceled(): boolean { return TransactionImpl.current.isCanceled }
}

class TransactionImpl extends Transaction {
  private static readonly none: TransactionImpl = new TransactionImpl({ hint: '<none>' })
  private static curr: TransactionImpl = TransactionImpl.none
  private static inspection: boolean = false
  private static frameStartTime: number = 0
  private static frameOverCounter: number = 0

  readonly margin: number
  readonly changeset: Changeset
  private pending: number
  private sealed: boolean
  private canceled?: Error
  private after?: TransactionImpl
  private promise?: Promise<void>
  private resolve: (value?: void) => void
  private reject: (reason: any) => void

  constructor(options: SnapshotOptions | null) {
    super()
    this.margin = TransactionImpl.curr !== undefined ? TransactionImpl.curr.margin + 1 : -1
    this.changeset = new Changeset(options)
    this.pending = 0
    this.sealed = false
    this.canceled = undefined
    this.after = undefined
    this.promise = undefined
    this.resolve = UNDEF
    this.reject = UNDEF
  }

  static get current(): TransactionImpl { return TransactionImpl.curr }
  get id(): number { return this.changeset.id }
  get hint(): string { return this.changeset.hint }
  get options(): SnapshotOptions { return this.changeset.options }
  get timestamp(): number { return this.changeset.timestamp }
  get error(): Error | undefined { return this.canceled }

  run<T>(func: F<T>, ...args: any[]): T {
    this.guard()
    return this.runImpl(undefined, func, ...args)
  }

  inspect<T>(func: F<T>, ...args: any[]): T {
    const restore = TransactionImpl.inspection
    try {
      TransactionImpl.inspection = true
      if (Log.isOn && Log.opt.transaction)
        Log.write(' ', ' ', `T${this.id}[${this.hint}] is being inspected by T${TransactionImpl.curr.id}[${TransactionImpl.curr.hint}]`)
      return this.runImpl(undefined, func, ...args)
    }
    finally {
      TransactionImpl.inspection = restore
    }
  }

  apply(): void {
    if (this.pending > 0)
      throw misuse('cannot apply transaction having active operations running')
    if (this.canceled)
      throw misuse(`cannot apply transaction that is already canceled: ${this.canceled}`)
    this.seal() // apply immediately, because pending === 0
  }

  seal(): this { // t1.seal().whenFinished().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(TransactionImpl.seal, this, undefined, undefined)
    return this
  }

  wrap<T>(func: F<T>, error: boolean): F<T> {
    this.guard()
    const self = this
    const inspect = TransactionImpl.inspection
    if (!inspect)
      self.run(TransactionImpl.wrapperEnter, self, error)
    else
      self.inspect(TransactionImpl.wrapperEnter, self, error)
    const wrappedForTransaction: F<T> = (...args: any[]): T => {
      if (!inspect)
        return self.runImpl<T>(undefined, TransactionImpl.wrapperLeave, self, error, func, ...args)
      else
        return self.inspect<T>(TransactionImpl.wrapperLeave, self, error, func, ...args)
    }
    return wrappedForTransaction
  }

  private static wrapperEnter<T>(t: TransactionImpl, error: boolean): void {
    if (!error)
      t.pending++
  }

  private static wrapperLeave<T>(t: TransactionImpl, error: boolean, func: F<T>, ...args: any[]): T {
    t.pending--
    const result = func(...args)
    // if (t.error && !error)
    //   throw t.error
    return result
  }

  cancel(error: Error, restartAfter?: Worker | null): this {
    this.runImpl(undefined, TransactionImpl.seal, this, error,
      restartAfter === null ? TransactionImpl.none : restartAfter)
    return this
  }

  get isCanceled(): boolean {
    return this.canceled !== undefined
  }

  get isFinished(): boolean {
    return this.sealed && this.pending === 0
  }

  async whenFinished(): Promise<void> {
    if (!this.isFinished)
      await this.acquirePromise()
  }

  static run<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T {
    const t: TransactionImpl = TransactionImpl.acquire(options)
    const root = t !== TransactionImpl.curr
    t.guard()
    let result: any = t.runImpl<T>(options?.logging, func, ...args)
    if (root) {
      if (result instanceof Promise) {
        result = TransactionImpl.outside(() => {
          return t.wrapToRetry(t.wrapToWaitUntilFinish(result), func, ...args)
        })
      }
      t.seal()
    }
    return result
  }

  static separate<T>(func: F<T>, ...args: any[]): T {
    return TransactionImpl.run({ separation: true }, func, ...args)
  }

  static outside<T>(func: F<T>, ...args: any[]): T {
    const outer = TransactionImpl.curr
    try {
      TransactionImpl.curr = TransactionImpl.none
      return func(...args)
    }
    finally {
      TransactionImpl.curr = outer
    }
  }

  static isFrameOver(everyN: number = 1, timeLimit: number = 10): boolean {
    TransactionImpl.frameOverCounter++
    let result = TransactionImpl.frameOverCounter % everyN === 0
    if (result) {
      const ms = performance.now() - TransactionImpl.frameStartTime
      result = ms > timeLimit
    }
    return result
  }

  static requestNextFrame(sleepTime: number = 0): Promise<void> {
    return pause(sleepTime)
  }

  // Internal

  private static acquire(options: SnapshotOptions | null): TransactionImpl {
    const curr = TransactionImpl.curr
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (options?.separation || curr.isFinished || curr.options.separation === 'isolated')
      return new TransactionImpl(options)
    else
      return TransactionImpl.curr
  }

  private guard(): void {
    // if (this.error) // prevent from continuing canceled transaction
    //   throw error(this.error.message, this.error)
    if (this.sealed && TransactionImpl.curr !== this)
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
          // if (Dbg.logging.transactions) Dbg.log("", "  ", `T${this.id} (${this.hint}) is waiting for restart`)
          // if (this.after !== this)
          //   await this.after.whenFinished()
          await this.after.whenFinished()
          // if (Dbg.logging.transactions) Dbg.log("", "  ", `T${this.id} (${this.hint}) is ready for restart`)
          const options: SnapshotOptions = {
            hint: `${this.hint} - restart after T${this.after.id}`,
            separation: this.options.separation === 'isolated' ? 'isolated' : true,
            logging: this.changeset.options.logging,
            token: this.changeset.options.token,
          }
          return TransactionImpl.run<T>(options, func, ...args)
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

  private runImpl<T>(logging: Partial<LoggingOptions> | undefined, func: F<T>, ...args: any[]): T {
    let result: T
    const outer = TransactionImpl.curr
    try {
      if (outer === TransactionImpl.none) {
        TransactionImpl.frameStartTime = performance.now()
        TransactionImpl.frameOverCounter = 0
      }
      TransactionImpl.curr = this
      this.pending++
      this.changeset.acquire(outer.changeset)
      result = func(...args)
      if (this.sealed && this.pending === 1) {
        if (!this.canceled)
          this.checkForConflicts() // merge with concurrent transactions
        else if (!this.after)
          throw this.canceled
      }
    }
    catch (e: any) {
      if (!TransactionImpl.inspection)
        this.cancel(e)
      throw e
    }
    finally {
      this.pending--
      if (this.sealed && this.pending === 0) {
        const reactive = this.applyOrDiscard() // it's critical to have no exceptions inside this call
        TransactionImpl.curr = outer
        TransactionImpl.outside(Changeset.enqueueReactiveFunctionsToRun, reactive)
      }
      else
        TransactionImpl.curr = outer
    }
    return result
  }

  private static seal(t: TransactionImpl, error?: Error, after?: TransactionImpl): void {
    if (!t.canceled && error) {
      t.canceled = error
      t.after = after
      if (Log.isOn && Log.opt.transaction) {
        Log.write('║', ' [!]', `${error.message}`, undefined, ' *** CANCEL ***')
        if (after && after !== TransactionImpl.none)
          Log.write('║', ' [!]', `T${t.id}[${t.hint}] will be restarted${t !== after ? ` after T${after.id}[${after.hint}]` : ''}`)
      }
      Changeset.revokeAllSubscriptions(t.changeset)
    }
    t.sealed = true
  }

  private checkForConflicts(): void {
    const conflicts = this.changeset.rebase()
    if (conflicts)
      this.tryResolveConflicts(conflicts)
  }

  private tryResolveConflicts(conflicts: ObjectSnapshot[]): void {
    throw error(`T${this.id}[${this.hint}] conflicts with: ${Dump.conflicts(conflicts)}`, undefined)
  }

  private applyOrDiscard(): Array<Observer> {
    // It's critical to have no exceptions in this block
    let reactive: Array<Observer>
    try {
      if (Log.isOn && Log.opt.change)
        Log.write('╠═', '', '', undefined, 'changes')
      reactive = this.changeset.applyOrDiscard(this.canceled)
      this.changeset.triggerGarbageCollection()
      if (this.promise) {
        if (this.canceled && !this.after)
          this.reject(this.canceled)
        else
          this.resolve()
      }
      if (Log.isOn)
        Object.freeze(this)
    }
    catch (e: any) {
      fatal(e)
      throw e
    }
    return reactive
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

  private static getCurrentChangeset(): Changeset {
    return TransactionImpl.curr.changeset
  }

  private static getEditableChangeset(): Changeset {
    if (TransactionImpl.inspection)
      throw misuse('cannot make changes during transaction inspection')
    return TransactionImpl.curr.changeset
  }

  static _init(): void {
    Changeset.current = TransactionImpl.getCurrentChangeset // override
    Changeset.edit = TransactionImpl.getEditableChangeset // override
    TransactionImpl.none.sealed = true
    TransactionImpl.none.changeset.applyOrDiscard()
    Changeset._init()
  }
}

TransactionImpl._init()
