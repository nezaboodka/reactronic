// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { UNDEF, F } from '../util/Utils'
import { Dbg, misuse, error, fatal } from '../util/Dbg'
import { Worker } from '../Worker'
import { SnapshotOptions, TraceOptions } from '../Options'
import { ObjectRevision } from './Data'
import { Snapshot, Dump } from './Snapshot'

export abstract class Transaction implements Worker {
  static get current(): Transaction { return TransactionImpl.current }

  abstract readonly id: number
  abstract readonly hint: string
  abstract readonly options: SnapshotOptions
  abstract readonly timestamp: number
  abstract readonly error: Error | undefined
  abstract readonly snapshot: Snapshot
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
  static run<T>(func: F<T>, ...args: any[]): T { return TransactionImpl.run<T>(func, ...args) }
  static runAs<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T { return TransactionImpl.runAs<T>(options, func, ...args) }
  static standalone<T>(func: F<T>, ...args: any[]): T { return TransactionImpl.standalone<T>(func, ...args) }
}

class TransactionImpl extends Transaction {
  private static readonly none: TransactionImpl = new TransactionImpl({ hint: '<none>' })
  private static curr: TransactionImpl = TransactionImpl.none
  private static inspection: boolean = false

  readonly margin: number
  readonly snapshot: Snapshot
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
    this.snapshot = new Snapshot(options)
    this.pending = 0
    this.sealed = false
    this.canceled = undefined
    this.after = undefined
    this.promise = undefined
    this.resolve = UNDEF
    this.reject = UNDEF
  }

  static get current(): TransactionImpl { return TransactionImpl.curr }
  get id(): number { return this.snapshot.id }
  get hint(): string { return this.snapshot.hint }
  get options(): SnapshotOptions { return this.snapshot.options }
  get timestamp(): number { return this.snapshot.timestamp }
  get error(): Error | undefined { return this.canceled }

  run<T>(func: F<T>, ...args: any[]): T {
    this.guard()
    return this.runImpl(undefined, func, ...args)
  }

  inspect<T>(func: F<T>, ...args: any[]): T {
    const restore = TransactionImpl.inspection
    try {
      TransactionImpl.inspection = true
      if (Dbg.isOn && Dbg.trace.transaction)
        Dbg.log(' ', ' ', `T${this.id}[${this.hint}] is being inspected by T${TransactionImpl.curr.id}[${TransactionImpl.curr.hint}]`)
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

  static run<T>(func: F<T>, ...args: any[]): T {
    return TransactionImpl.runAs<T>(null, func, ...args)
  }

  static runAs<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T {
    const t: TransactionImpl = TransactionImpl.acquire(options)
    const root = t !== TransactionImpl.curr
    t.guard()
    let result: any = t.runImpl<T>(options?.trace, func, ...args)
    if (root) {
      if (result instanceof Promise)
        result = TransactionImpl.standalone(() => {
          return t.wrapToRetry(t.wrapToWaitUntilFinish(result), func, ...args)
        })
      t.seal()
    }
    return result
  }

  static standalone<T>(func: F<T>, ...args: any[]): T {
    const outer = TransactionImpl.curr
    try {
      TransactionImpl.curr = TransactionImpl.none
      return func(...args)
    }
    finally {
      TransactionImpl.curr = outer
    }
  }

  // Internal

  private static acquire(options: SnapshotOptions | null): TransactionImpl {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const curr = TransactionImpl.curr
    if ((options !== null && options.standalone !== false) ||
      curr.isFinished || curr.options.standalone === 'isolated')
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
            standalone: this.options.standalone === 'isolated' ? 'isolated' : true,
            trace: this.snapshot.options.trace,
            token: this.snapshot.options.token,
          }
          return TransactionImpl.runAs<T>(options, func, ...args)
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

  private runImpl<T>(trace: Partial<TraceOptions> | undefined, func: F<T>, ...args: any[]): T {
    let result: T
    const outer = TransactionImpl.curr
    try {
      TransactionImpl.curr = this
      this.pending++
      this.snapshot.acquire(outer.snapshot)
      result = func(...args)
      if (this.sealed && this.pending === 1) {
        if (!this.canceled) {
          this.checkForConflicts() // merge with concurrent transactions
          let more = true
          while (more) {
            if (Dbg.isOn && Dbg.trace.operation && this.snapshot.options.token === undefined)
              Dbg.log('╠═', '', '', undefined, `propagation: round ${this.snapshot.round}`)
            Snapshot.propagateAllChangesThroughSubscriptions(this.snapshot)
            if (this.options.standalone !== 'isolated') {
              if (Dbg.isOn && Dbg.trace.operation)
                if (this.snapshot.reactions.length > 0)
                  Dbg.log('╠═', '', '', undefined, `reactions: round ${this.snapshot.round + 1}`)
              more = TransactionImpl.runReactions(this, false)
            }
            else
              more = false
          }
        }
        else if (!this.after)
          throw this.canceled
      }
    }
    catch (e) {
      if (!TransactionImpl.inspection)
        this.cancel(e)
      throw e
    }
    finally {
      this.pending--
      if (this.sealed && this.pending === 0) {
        this.applyOrDiscard() // it's critical to have no exceptions inside this call
        TransactionImpl.curr = outer
        TransactionImpl.runReactions(this, true)
      }
      else
        TransactionImpl.curr = outer
    }
    return result
  }

  private static runReactions(t: TransactionImpl, end: boolean): boolean {
    let result = false
    const ctx = t.snapshot
    const reactions = ctx.reactions
    if (!end) {
      ctx.reactions = []
      reactions.forEach(x => {
        if (x.standalone === false)
          result = true
        ctx.round++
        x.runIfNotUpToDate(ctx.reactions)
      })
    }
    else
      reactions.forEach(x => x.runIfNotUpToDate(undefined))
    return result
  }

  private static seal(t: TransactionImpl, error?: Error, after?: TransactionImpl): void {
    if (!t.canceled && error) {
      t.canceled = error
      t.after = after
      if (Dbg.isOn && Dbg.trace.transaction) {
        Dbg.log('║', ' [!]', `${error.message}`, undefined, ' *** CANCEL ***')
        if (after && after !== TransactionImpl.none)
          Dbg.log('║', ' [!]', `T${t.id}[${t.hint}] will be restarted${t !== after ? ` after T${after.id}[${after.hint}]` : ''}`)
      }
      Snapshot.revokeAllSubscriptions(t.snapshot)
    }
    t.sealed = true
  }

  private checkForConflicts(): void {
    const conflicts = this.snapshot.rebase()
    if (conflicts)
      this.tryResolveConflicts(conflicts)
  }

  private tryResolveConflicts(conflicts: ObjectRevision[]): void {
    throw error(`T${this.id}[${this.hint}] conflicts with: ${Dump.conflicts(conflicts)}`, undefined)
  }

  private applyOrDiscard(): void {
    // It's critical to have no exceptions in this block
    try {
      if (Dbg.isOn && Dbg.trace.change)
        Dbg.log('╠═', '', '', undefined, 'changes')
      this.snapshot.applyOrDiscard(this.canceled)
      this.snapshot.collectGarbage()
      if (this.promise) {
        if (this.canceled && !this.after)
          this.reject(this.canceled)
        else
          this.resolve()
      }
      if (Dbg.isOn)
        Object.freeze(this)
    }
    catch (e) {
      fatal(e)
      throw e
    }
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

  private static getCurrentSnapshot(): Snapshot {
    return TransactionImpl.curr.snapshot
  }

  private static editSnapshot(): Snapshot {
    if (TransactionImpl.inspection)
      throw misuse('cannot make changes during transaction inspection')
    return TransactionImpl.curr.snapshot
  }

  static _init(): void {
    Snapshot.current = TransactionImpl.getCurrentSnapshot // override
    Snapshot.edit = TransactionImpl.editSnapshot // override
    TransactionImpl.none.sealed = true
    TransactionImpl.none.snapshot.applyOrDiscard()
    Snapshot._init()
  }
}

TransactionImpl._init()
