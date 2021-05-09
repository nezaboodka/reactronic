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
import { Snapshot, Hints } from './Snapshot'

export abstract class Operation implements Worker {
  static get current(): Operation { return OperationImpl.current }

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
  abstract bind<T>(func: F<T>, secondary: boolean): F<T>
  abstract cancel(error: Error, retryAfterOrIgnore?: Worker | null): this
  abstract readonly isCanceled: boolean
  abstract readonly isFinished: boolean
  async whenFinished(): Promise<void> { /* to be overridden */ }

  static create(options: SnapshotOptions | null): Operation { return new OperationImpl(options) }
  static run<T>(func: F<T>, ...args: any[]): T { return OperationImpl.run<T>(func, ...args) }
  static runAs<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T { return OperationImpl.runAs<T>(options, func, ...args) }
  static isolated<T>(func: F<T>, ...args: any[]): T { return OperationImpl.isolated<T>(func, ...args) }
}

class OperationImpl extends Operation {
  private static readonly none: OperationImpl = new OperationImpl({ hint: '<none>' })
  private static curr: OperationImpl = OperationImpl.none
  private static inspection: boolean = false

  readonly margin: number
  readonly snapshot: Snapshot
  private pending: number
  private sealed: boolean
  private canceled?: Error
  private after?: OperationImpl
  private promise?: Promise<void>
  private resolve: (value?: void) => void
  private reject: (reason: any) => void

  constructor(options: SnapshotOptions | null) {
    super()
    this.margin = OperationImpl.curr ? OperationImpl.curr.margin + 1 : -1
    this.snapshot = new Snapshot(options)
    this.pending = 0
    this.sealed = false
    this.canceled = undefined
    this.after = undefined
    this.promise = undefined
    this.resolve = UNDEF
    this.reject = UNDEF
  }

  static get current(): OperationImpl { return OperationImpl.curr }
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
    const restore = OperationImpl.inspection
    try {
      OperationImpl.inspection = true
      if (Dbg.isOn && Dbg.trace.operation)
        Dbg.log(' ', ' ', `T${this.id}[${this.hint}] is being inspected by T${OperationImpl.curr.id}[${OperationImpl.curr.hint}]`)
      return this.runImpl(undefined, func, ...args)
    }
    finally {
      OperationImpl.inspection = restore
    }
  }

  apply(): void {
    if (this.pending > 0)
      throw misuse('cannot apply operation having active functions running')
    if (this.canceled)
      throw misuse(`cannot apply operation that is already canceled: ${this.canceled}`)
    this.seal() // apply immediately, because pending === 0
  }

  seal(): this { // t1.seal().whenFinished().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(OperationImpl.seal, this)
    return this
  }

  bind<T>(func: F<T>, error: boolean): F<T> {
    this.guard()
    const self = this
    const inspect = OperationImpl.inspection
    if (!inspect)
      self.run(OperationImpl.boundEnter, self, error)
    else
      self.inspect(OperationImpl.boundEnter, self, error)
    const operationBound: F<T> = (...args: any[]): T => {
      if (!inspect)
        return self.runImpl<T>(undefined, OperationImpl.boundLeave, self, error, func, ...args)
      else
        return self.inspect<T>(OperationImpl.boundLeave, self, error, func, ...args)
    }
    return operationBound
  }

  private static boundEnter<T>(t: OperationImpl, error: boolean): void {
    if (!error)
      t.pending++
  }

  private static boundLeave<T>(t: OperationImpl, error: boolean, func: F<T>, ...args: any[]): T {
    t.pending--
    const result = func(...args)
    // if (t.error && !error)
    //   throw t.error
    return result
  }

  cancel(error: Error, restartAfter?: Worker | null): this {
    this.runImpl(undefined, OperationImpl.seal, this, error,
      restartAfter === null ? OperationImpl.none : restartAfter)
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
    return OperationImpl.runAs<T>(null, func, ...args)
  }

  static runAs<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T {
    const t: OperationImpl = OperationImpl.acquire(options)
    const root = t !== OperationImpl.curr
    t.guard()
    let result: any = t.runImpl<T>(options?.trace, func, ...args)
    if (root) {
      if (result instanceof Promise)
        result = OperationImpl.isolated(() => {
          return t.wrapToRetry(t.wrapToWaitUntilFinish(result), func, ...args)
        })
      t.seal()
    }
    return result
  }

  static isolated<T>(func: F<T>, ...args: any[]): T {
    const outer = OperationImpl.curr
    try {
      OperationImpl.curr = OperationImpl.none
      return func(...args)
    }
    finally {
      OperationImpl.curr = outer
    }
  }

  // Internal

  private static acquire(options: SnapshotOptions | null): OperationImpl {
    return options?.spawn || OperationImpl.curr.isFinished
      ? new OperationImpl(options)
      : OperationImpl.curr
  }

  private guard(): void {
    // if (this.error) // prevent from continuing canceled operation
    //   throw error(this.error.message, this.error)
    if (this.sealed && OperationImpl.curr !== this)
      throw misuse('cannot run operation that is already sealed')
  }

  private async wrapToRetry<T>(p: Promise<T>, func: F<T>, ...args: any[]): Promise<T | undefined> {
    try {
      const result = await p
      if (this.canceled)
        throw this.canceled
      return result
    }
    catch (error) {
      if (this.after !== OperationImpl.none) {
        if (this.after) {
          // if (Dbg.logging.operations) Dbg.log("", "  ", `T${this.id} (${this.hint}) is waiting for restart`)
          // if (this.after !== this)
          //   await this.after.whenFinished()
          await this.after.whenFinished()
          // if (Dbg.logging.operations) Dbg.log("", "  ", `T${this.id} (${this.hint}) is ready for restart`)
          const options: SnapshotOptions = {
            hint: `${this.hint} - restart after T${this.after.id}`,
            spawn: true,
            trace: this.snapshot.options.trace,
            token: this.snapshot.options.token,
          }
          return OperationImpl.runAs<T>(options, func, ...args)
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
    const outer = OperationImpl.curr
    try {
      OperationImpl.curr = this
      this.pending++
      this.snapshot.acquire(outer.snapshot)
      result = func(...args)
      if (this.sealed && this.pending === 1) {
        if (!this.canceled)
          this.checkForConflicts() // merge with concurrent operations
        else if (!this.after)
          throw this.canceled
      }
    }
    catch (e) {
      if (!OperationImpl.inspection)
        this.cancel(e)
      throw e
    }
    finally {
      this.pending--
      if (this.sealed && this.pending === 0) {
        this.applyOrDiscard() // it's critical to have no exceptions inside this call
        OperationImpl.curr = outer
        OperationImpl.isolated(OperationImpl.executeReactions, this)
      }
      else
        OperationImpl.curr = outer
    }
    return result
  }

  private static executeReactions(t: OperationImpl): void {
    t.snapshot.reactions.forEach(x => x.ensureUpToDate(false, true))
  }

  private static seal(t: OperationImpl, error?: Error, after?: OperationImpl): void {
    if (!t.canceled && error) {
      t.canceled = error
      t.after = after
      if (Dbg.isOn && Dbg.trace.operation) {
        Dbg.log('║', ' [!]', `${error.message}`, undefined, ' *** CANCEL ***')
        if (after && after !== OperationImpl.none)
          Dbg.log('║', ' [!]', `T${t.id}[${t.hint}] will be restarted${t !== after ? ` after T${after.id}[${after.hint}]` : ''}`)
      }
      Snapshot.propagateChanges(t.snapshot, error)
    }
    t.sealed = true
  }

  private checkForConflicts(): void {
    const conflicts = this.snapshot.rebase()
    if (conflicts)
      this.tryResolveConflicts(conflicts)
  }

  private tryResolveConflicts(conflicts: ObjectRevision[]): void {
    throw error(`T${this.id}[${this.hint}] conflicts with: ${Hints.conflicts(conflicts)}`, undefined)
  }

  private applyOrDiscard(): void {
    // It's critical to have no exceptions in this block
    try {
      if (Dbg.isOn && Dbg.trace.change)
        Dbg.log('╠══', '', '', undefined, ' changes')
      this.snapshot.applyOrDiscard(this.canceled)
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
    return OperationImpl.curr.snapshot
  }

  private static editSnapshot(): Snapshot {
    if (OperationImpl.inspection)
      throw misuse('cannot make changes during operation inspection')
    return OperationImpl.curr.snapshot
  }

  static _init(): void {
    Snapshot.current = OperationImpl.getCurrentSnapshot // override
    Snapshot.edit = OperationImpl.editSnapshot // override
    OperationImpl.none.sealed = true
    OperationImpl.none.snapshot.applyOrDiscard()
    Snapshot._init()
  }
}

OperationImpl._init()
