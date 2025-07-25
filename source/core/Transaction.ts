// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { UNDEF, F, pause } from "../util/Utils.js"
import { Log, misuse, error, fatal } from "../util/Dbg.js"
import { Worker } from "../Worker.js"
import { Isolation } from "../Enums.js"
import { SnapshotOptions, LoggingOptions } from "../Options.js"
import { Meta, ObjectHandle, ObjectVersion, OperationFootprint, ContentFootprint, FieldKey } from "./Data.js"
import { Changeset, Dump, EMPTY_OBJECT_VERSION, UNDEFINED_REVISION } from "./Changeset.js"

export abstract class Transaction implements Worker {
  static get current(): Transaction { return TransactionImpl.curr }

  abstract readonly id: number
  abstract readonly hint: string
  abstract readonly options: SnapshotOptions
  abstract readonly timestamp: number
  abstract readonly error: Error | undefined
  abstract readonly changeset: Changeset
  abstract readonly margin: number
  abstract readonly parent?: Transaction

  abstract run<T>(func: F<T>, ...args: any[]): T
  abstract inspect<T>(func: F<T>, ...args: any[]): T
  abstract apply(): void
  abstract seal(): this
  abstract wrapAsPending<T>(func: F<T>, secondary: boolean): F<T>
  abstract cancel(error: Error, retryAfterOrIgnore?: Worker | null): this
  abstract readonly isCanceled: boolean
  abstract readonly isFinished: boolean
  async whenFinished(includingParent?: boolean): Promise<void> { /* to be overridden */ }

  static create(options: SnapshotOptions | null, parent?: Transaction): Transaction { return new TransactionImpl(options, parent as TransactionImpl) }
  static run<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T { return TransactionImpl.run<T>(options, func, ...args) }
  static isolate<T>(func: F<T>, ...args: any[]): T { return TransactionImpl.isolate(func, ...args) }
  static outside<T>(func: F<T>, ...args: any[]): T { return TransactionImpl.outside<T>(func, ...args) }

  static isFrameOver(everyN: number = 1, timeLimit: number = 10): boolean { return TransactionImpl.isFrameOver(everyN, timeLimit) }
  static requestNextFrame(sleepTime: number = 0): Promise<void> { return TransactionImpl.requestNextFrame(sleepTime) }
  static get isCanceled(): boolean { return TransactionImpl.curr.isCanceled }
}

export class TransactionImpl extends Transaction {
  private static readonly none: TransactionImpl = new TransactionImpl({ hint: "<none>" })
  private static gCurr: TransactionImpl = TransactionImpl.none
  private static isInspectionMode: boolean = false
  private static frameStartTime: number = 0
  private static frameOverCounter: number = 0

  readonly margin: number
  readonly parent?: TransactionImpl
  readonly changeset: Changeset
  private pending: number
  private sealed: boolean
  private canceled?: Error
  private after?: TransactionImpl
  private promise?: Promise<void>
  private resolve: (value?: void) => void
  private reject: (reason: any) => void

  constructor(options: SnapshotOptions | null, parent?: TransactionImpl) {
    super()
    this.margin = TransactionImpl.gCurr !== undefined ? TransactionImpl.gCurr.margin + 1 : -1
    this.parent = parent
    this.changeset = new Changeset(options, parent?.changeset)
    this.pending = 0
    this.sealed = false
    this.canceled = undefined
    this.after = undefined
    this.promise = undefined
    this.resolve = UNDEF
    this.reject = UNDEF
  }

  static get curr(): TransactionImpl { return TransactionImpl.gCurr }
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
    const outer = TransactionImpl.isInspectionMode
    try {
      TransactionImpl.isInspectionMode = true
      if (Log.isOn && Log.opt.transaction)
        Log.write(" ", " ", `T${this.id}[${this.hint}] is being inspected by T${TransactionImpl.gCurr.id}[${TransactionImpl.gCurr.hint}]`)
      return this.runImpl(undefined, func, ...args)
    }
    finally {
      TransactionImpl.isInspectionMode = outer
    }
  }

  apply(): void {
    if (this.pending > 0)
      throw misuse("cannot apply transaction having active operations running")
    if (this.canceled)
      throw misuse(`cannot apply transaction that is already canceled: ${this.canceled}`)
    this.seal() // apply immediately, because pending === 0
  }

  seal(): this { // t1.seal().whenFinished().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(TransactionImpl.seal, this, undefined, undefined)
    return this
  }

  wrapAsPending<T>(func: F<T>, secondary: boolean): F<T> {
    this.guard()
    const self = this
    const inspection = TransactionImpl.isInspectionMode
    if (!inspection)
      self.run(TransactionImpl.preparePendingFunction, self, secondary)
    else
      self.inspect(TransactionImpl.preparePendingFunction, self, secondary)
    const wrappedAsPendingForTransaction: F<T> = (...args: any[]): T => {
      if (!inspection)
        return self.runImpl<T>(undefined, TransactionImpl.runPendingFunction, self, secondary, func, ...args)
      else
        return self.inspect<T>(TransactionImpl.runPendingFunction, self, secondary, func, ...args)
    }
    return wrappedAsPendingForTransaction
  }

  private static preparePendingFunction<T>(t: TransactionImpl, secondary: boolean): void {
    if (!secondary)
      t.pending++
  }

  private static runPendingFunction<T>(t: TransactionImpl, secondary: boolean, func: F<T>, ...args: any[]): T {
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

  override async whenFinished(includingParent?: boolean): Promise<void> {
    if (includingParent && this.parent)
      await this.parent.whenFinished(includingParent)
    else if (!this.isFinished)
      await this.acquirePromise()
  }

  static override run<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T {
    const t: TransactionImpl = TransactionImpl.acquire(options)
    const isRoot = t !== TransactionImpl.gCurr
    t.guard()
    let result: any = t.runImpl<T>(options?.logging, func, ...args)
    if (isRoot) {
      if (result instanceof Promise) {
        result = TransactionImpl.outside(() => {
          return t.wrapToRetry(t.wrapToWaitUntilFinish(result), func, ...args)
        })
      }
      t.seal()
    }
    return result
  }

  static override isolate<T>(func: F<T>, ...args: any[]): T {
    return TransactionImpl.run({ isolation: Isolation.disjoinFromOuterTransaction }, func, ...args)
  }

  static override outside<T>(func: F<T>, ...args: any[]): T {
    const outer = TransactionImpl.gCurr
    try {
      TransactionImpl.gCurr = TransactionImpl.none
      return func(...args)
    }
    finally {
      TransactionImpl.gCurr = outer
    }
  }

  static override isFrameOver(everyN: number = 1, timeLimit: number = 10): boolean {
    TransactionImpl.frameOverCounter++
    let result = TransactionImpl.frameOverCounter % everyN === 0
    if (result) {
      const ms = performance.now() - TransactionImpl.frameStartTime
      result = ms > timeLimit
    }
    return result
  }

  static override requestNextFrame(sleepTime: number = 0): Promise<void> {
    return pause(sleepTime)
  }

  // Internal

  private static acquire(options: SnapshotOptions | null): TransactionImpl {
    const outer = TransactionImpl.gCurr
    const isolation = options?.isolation ?? Isolation.joinToCurrentTransaction
    if (outer.isFinished || outer.options.isolation === Isolation.disjoinFromOuterAndInnerTransactions)
      return new TransactionImpl(options)
    else if (isolation === Isolation.joinAsNestedTransaction)
      return new TransactionImpl(options, outer)
    else if (isolation !== Isolation.joinToCurrentTransaction)
      return new TransactionImpl(options)
    else // isolation === Isolation.joinToExistingTransaction
      return outer
  }

  private guard(): void {
    // if (this.error) // prevent from continuing canceled transaction
    //   throw error(this.error.message, this.error)
    if (this.sealed && TransactionImpl.gCurr !== this)
      throw misuse("cannot run transaction that is already sealed")
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
            isolation: this.options.isolation === Isolation.joinToCurrentTransaction ? Isolation.disjoinFromOuterTransaction : this.options.isolation,
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
    const outer = TransactionImpl.gCurr
    const p = this.parent
    try {
      if (outer === TransactionImpl.none) {
        TransactionImpl.frameStartTime = performance.now()
        TransactionImpl.frameOverCounter = 0
      }
      TransactionImpl.gCurr = this
      this.pending++
      const acquired = this.changeset.acquire(outer.changeset)
      if (acquired && p)
        p.run(() => p.pending++)
      result = func(...args)
      if (this.sealed && this.pending === 1) {
        if (!this.canceled)
          this.checkForConflicts() // merge with concurrent transactions
        else if (!this.after)
          throw this.canceled
      }
    }
    catch (e: any) {
      if (!TransactionImpl.isInspectionMode)
        this.cancel(e)
      throw e
    }
    finally {
      this.pending--
      if (this.sealed && this.pending === 0) {
        const obsolete = this.applyOrDiscard() // it's critical to have no exceptions inside this call
        if (p)
          p.runImpl(undefined, () => p.pending--)
        TransactionImpl.gCurr = outer
        TransactionImpl.outside(Changeset.enqueueReactionsToRun, obsolete)
      }
      else
        TransactionImpl.gCurr = outer
    }
    return result
  }

  private static seal(t: TransactionImpl, error?: Error, after?: TransactionImpl): void {
    if (!t.canceled && error) {
      t.canceled = error
      t.after = after
      if (Log.isOn && Log.opt.transaction) {
        Log.write("║", " [!]", `${error.message}`, undefined, " *** CANCEL ***")
        if (after && after !== TransactionImpl.none)
          Log.write("║", " [!]", `T${t.id}[${t.hint}] will be restarted${t !== after ? ` after T${after.id}[${after.hint}]` : ""}`)
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

  private tryResolveConflicts(conflicts: ObjectVersion[]): void {
    throw error(`T${this.id}[${this.hint}] conflicts with: ${Dump.conflicts(conflicts)}`, undefined)
  }

  private applyOrDiscard(): Array<OperationFootprint> {
    // It's critical to have no exceptions in this block
    let obsolete: Array<OperationFootprint>
    try {
      if (Log.isOn && Log.opt.change)
        Log.write("╠═", "", "", undefined, "changes")
      this.changeset.seal()
      obsolete = this.applyOrDiscardChangeset()
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
    return obsolete
  }

  applyOrDiscardChangeset(): Array<OperationFootprint> {
    const error = this.canceled
    const changeset = this.changeset
    changeset.items.forEach((ov: ObjectVersion, h: ObjectHandle) => {
      changeset.sealObjectVersion(h, ov)
      if (!error) {
        // if (this.timestamp < h.head.snapshot.timestamp)
        //   console.log(`!!! timestamp downgrade detected ${h.head.snapshot.timestamp} -> ${this.timestamp} !!!`)
        this.applyObjectChanges(h, ov)
        if (Changeset.garbageCollectionSummaryInterval < Number.MAX_SAFE_INTEGER) {
          Changeset.totalObjectSnapshotCount++
          if (ov.former.objectVersion === EMPTY_OBJECT_VERSION)
            Changeset.totalObjectHandleCount++
        }
      }
    })
    if (Log.isOn) {
      if (Log.opt.change && !error && !changeset.parent) {
        changeset.items.forEach((ov: ObjectVersion, h: ObjectHandle) => {
          const fields: string[] = []
          ov.changes.forEach((o, fk) => fields.push(fk.toString()))
          const s = fields.join(", ")
          Log.write("║", "√", `${Dump.snapshot2(h, ov.changeset)} (${s}) is ${ov.former.objectVersion === EMPTY_OBJECT_VERSION ? "constructed" : `applied over #${h.id}t${ov.former.objectVersion.changeset.id}s${ov.former.objectVersion.changeset.timestamp}`}`)
        })
      }
      if (Log.opt.transaction)
        Log.write(changeset.timestamp < UNDEFINED_REVISION ? "╚══" : /* istanbul ignore next */ "═══", `s${this.timestamp}`, `${this.hint} - ${error ? "CANCEL" : "APPLY"}(${this.changeset.items.size})${error ? ` - ${error}` : ""}`)
    }
    let obsolete = changeset.obsolete
    if (changeset.parent) {
      if (changeset.obsolete.length > 0) {
        // Migrate obsolete reactions
        for (const o of changeset.obsolete)
          changeset.parent.obsolete.push(o)
        obsolete = []
      }
    }
    else if (!error)
      Changeset.propagateAllChangesThroughSubscriptions(changeset)
    return obsolete
  }

  applyObjectChanges(h: ObjectHandle, ov: ObjectVersion): void {
    const parent = this.parent
    if (parent)
      TransactionImpl.migrateObjectChangesToAnotherTransaction(h, ov, parent)
    else
      h.applied = ov
  }

  static migrateObjectChangesToAnotherTransaction(h: ObjectHandle, ov: ObjectVersion, tParent: Transaction): void {
    const csParent = tParent.changeset
    const ovParent = csParent.getEditableObjectVersion(h, Meta.Undefined, undefined)
    if (ov.former.objectVersion.changeset === EMPTY_OBJECT_VERSION.changeset) {
      for (const fk in ov.data) {
        TransactionImpl.migrateFieldVersionToAnotherTransaction(h, fk, ov, ovParent, tParent)
      }
    }
    else {
      ov.changes.forEach((o, fk) => {
        TransactionImpl.migrateFieldVersionToAnotherTransaction(h, fk, ov, ovParent, tParent)
      })
    }
    // if (Log.isOn && Log.opt.write)
    //   Log.write("║", " !!", `${Dump.obj(h)} - snapshot is replaced (revision ${ov.revision})`)
  }

  static migrateFieldVersionToAnotherTransaction(h: ObjectHandle, fk: FieldKey, ov: ObjectVersion, ovParent: ObjectVersion, tParent: Transaction): void {
    const csParent = tParent.changeset
    const cf = ov.data[fk] as ContentFootprint
    const cfParent = ovParent.data[fk] as ContentFootprint
    if (cf.isComputed) {
      const migrated = TransactionImpl.migrateContentFootprint(cf, tParent)
      if (ovParent.former.objectVersion.data[fk] !== cfParent) { // there are changes in parent
        // Migrate subscribers from parent
        let subscribers = cfParent.subscribers
        if (subscribers) {
          const migratedSubscribers = migrated.subscribers = new Set<OperationFootprint>()
          subscribers.forEach(o => {
            const conformingObservables = o.observables!
            const sub = conformingObservables.get(cfParent)!
            conformingObservables.delete(cfParent)
            conformingObservables.set(migrated, sub)
            migratedSubscribers.add(o)
          })
          cfParent.subscribers = undefined
        }
        // Migrate subscribers from current (child)
        subscribers = cf.subscribers
        if (subscribers) {
          let migratedSubscribers = migrated.subscribers
          if (migratedSubscribers === undefined)
            migratedSubscribers = migrated.subscribers = new Set<OperationFootprint>()
          subscribers.forEach(o => {
            const conformingObservables = o.observables!
            const sub = conformingObservables.get(cf)!
            conformingObservables.delete(cf)
            conformingObservables.set(migrated, sub)
            migratedSubscribers.add(o)
          })
          cf.subscribers = undefined
        }
        // Migrate observables from current (child)
        const observables = (cf as unknown as OperationFootprint).observables
        const migratedObservables = (migrated as unknown as OperationFootprint).observables
        if (observables) {
          observables.forEach((s, o) => {
            const conformingSubscribers = o.subscribers!
            conformingSubscribers.delete(cf as unknown as OperationFootprint)!
            conformingSubscribers.add(migrated as unknown as OperationFootprint)
            migratedObservables!.set(o, s)
          })
          observables.clear()
        }
        ovParent.data[fk] = migrated
      }
      else {
        // Migrate reactions from current (child)
        const subscribers = cf.subscribers
        if (subscribers) {
          const migratedReactions = migrated.subscribers = new Set<OperationFootprint>()
          subscribers.forEach(o => {
            const conformingObservables = o.observables!
            const sub = conformingObservables.get(cf)!
            conformingObservables.delete(cf)
            conformingObservables.set(migrated, sub)
            migratedReactions.add(o)
          })
          cf.subscribers = undefined
        }
        // Migrate observables from current (child)
        const observables = (cf as unknown as OperationFootprint).observables
        const migratedObservables = (migrated as unknown as OperationFootprint).observables
        if (observables) {
          observables.forEach((s, o) => {
            const conformingSubscribers = o.subscribers!
            conformingSubscribers.delete(cf as unknown as OperationFootprint)
            conformingSubscribers.add(migrated as unknown as OperationFootprint)
            migratedObservables!.set(o, s)
          })
          observables.clear()
        }
        ovParent.data[fk] = migrated
      }
      csParent.bumpBy(ovParent.former.objectVersion.changeset.timestamp)
      Changeset.markEdited(undefined, migrated, true, ovParent, fk, h)
    }
    else {
      const parentContent = cfParent?.content
      if (ovParent.former.objectVersion.data[fk] !== cfParent) { // there are changes in parent
        cfParent.content = cf.content
        // Migrate subscriptions
        const subscribers = cf.subscribers
        if (subscribers) {
          if (cfParent.subscribers === undefined)
            cfParent.subscribers = new Set()
          subscribers.forEach(o => {
            const conformingObservables = o.observables!
            const sub = conformingObservables.get(cf)!
            conformingObservables.delete(cf)
            conformingObservables.set(cfParent, sub)
            cfParent.subscribers!.add(o)
          })
        }
      }
      else
        ovParent.data[fk] = cf // just use field version instance from child transaction
      Changeset.markEdited(parentContent, cf.content, true, ovParent, fk, h)
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

  private static getCurrentChangeset(): Changeset {
    return TransactionImpl.gCurr.changeset
  }

  private static getEditableChangeset(): Changeset {
    if (TransactionImpl.isInspectionMode)
      throw misuse("cannot make changes during transaction inspection")
    return TransactionImpl.gCurr.changeset
  }

  /* istanbul ignore next */
  static migrateContentFootprint = function (fv: ContentFootprint, target: Transaction): ContentFootprint {
    throw misuse("this implementation of migrateContentFootprint should never be called")
  }

  static _init(): void {
    Changeset.current = TransactionImpl.getCurrentChangeset // override
    Changeset.edit = TransactionImpl.getEditableChangeset // override
    TransactionImpl.none.sealed = true
    TransactionImpl.none.changeset.seal()
    Changeset._init()
  }
}

TransactionImpl._init()
