// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from "../util/Utils.js"
import { Log, misuse } from "../util/Dbg.js"
import { Kind, Reentrance, Isolation } from "../Enums.js"
import { ReactiveOperation, ReactivityOptions, LoggingOptions, SnapshotOptions } from "../Options.js"
import { ObjectVersion, FieldKey, ObjectHandle, ContentFootprint, OperationFootprint, Subscription, Meta, AbstractChangeset } from "./Data.js"
import { Changeset, Dump, EMPTY_OBJECT_VERSION, MAX_REVISION } from "./Changeset.js"
import { Transaction, TransactionImpl } from "./Transaction.js"
import { Indicator, IndicatorImpl } from "./Indicator.js"
import { Mvcc, OptionsImpl } from "./Mvcc.js"
import { JournalImpl } from "./Journal.js"

const BOOT_ARGS: any[] = []
const BOOT_CAUSE = "<boot>"
const EMPTY_HANDLE = new ObjectHandle(undefined, undefined, Mvcc.observable, EMPTY_OBJECT_VERSION, "<boot>")

type ReuseOrRelaunchContext = {
  readonly footprint: OperationFootprintImpl
  readonly isReusable: boolean
  readonly changeset: Changeset
  readonly objectVersion: ObjectVersion
}

export class ReactiveOperationImpl implements ReactiveOperation<any> {
  readonly ownerHandle: ObjectHandle
  readonly fieldKey: FieldKey

  configure(options: Partial<ReactivityOptions>): ReactivityOptions { return ReactiveOperationImpl.configureImpl(this, options) }
  get options(): ReactivityOptions { return this.peek(undefined).footprint.options }
  get nonreactive(): any { return this.peek(undefined).footprint.content }
  get args(): ReadonlyArray<any> { return this.use().footprint.args }
  get result(): any { return this.reuseOrRelaunch(true, undefined).content }
  get error(): boolean { return this.use().footprint.error }
  get stamp(): number { return this.use().objectVersion.changeset.timestamp }
  get isReusable(): boolean { return this.use().isReusable }
  markObsolete(): void { Transaction.run({ hint: Log.isOn ? `markObsolete(${Dump.obj(this.ownerHandle, this.fieldKey)})` : "markObsolete()" }, ReactiveOperationImpl.markObsolete, this) }
  pullLastResult(args?: any[]): any { return this.reuseOrRelaunch(true, args).content }

  constructor(h: ObjectHandle, fk: FieldKey) {
    this.ownerHandle = h
    this.fieldKey = fk
  }

  reuseOrRelaunch(weak: boolean, args: any[] | undefined): OperationFootprintImpl {
    let ror: ReuseOrRelaunchContext = this.peek(args)
    const ctx = ror.changeset
    const footprint: OperationFootprintImpl = ror.footprint
    const opts = footprint.options
    if (!ror.isReusable && !ror.objectVersion.disposed
      && (!weak || footprint.cause === BOOT_CAUSE || !footprint.successor ||
        footprint.successor.transaction.isFinished)) {
      // transaction => joinToCurrent
      // reaction => joinAsNested
      // cached => joinToCurrent
      // weak => disjoinFromOuterTransaction
      const isolation: Isolation = !weak ? opts.isolation : Isolation.disjoinFromOuterTransaction
      const token = opts.noSideEffects ? this : undefined
      const ror2 = this.relaunch(ror, isolation, opts, token, args)
      const ctx2 = ror2.footprint.changeset
      if (!weak || ctx === ctx2 || (ctx2.sealed && ctx.timestamp >= ctx2.timestamp))
        ror = ror2
    }
    else if (Log.isOn && Log.opt.operation && (opts.logging === undefined ||
      opts.logging.operation === undefined || opts.logging.operation === true))
      Log.write(Transaction.current.isFinished ? "" : "║", " (=)",
        `${Dump.snapshot2(ror.footprint.descriptor.ownerHandle, ror.changeset, this.fieldKey)} result is reused from T${ror.footprint.transaction.id}[${ror.footprint.transaction.hint}]`)
    const t = ror.footprint
    Changeset.markUsed(t, ror.objectVersion, this.fieldKey, this.ownerHandle, t.options.kind, weak)
    return t
  }

  static manageReactiveOperation(method: F<any>): ReactiveOperation<any> {
    const ctl = Meta.get<ReactiveOperation<any> | undefined>(method, Meta.Descriptor)
    if (!ctl)
      throw misuse(`given method is not decorated as reactronic one: ${method.name}`)
    return ctl
  }

  static configureImpl(self: ReactiveOperationImpl | undefined, options: Partial<ReactivityOptions>): ReactivityOptions {
    let footprint: OperationFootprintImpl | undefined
    if (self)
      footprint = self.edit().footprint
    else
      footprint = OperationFootprintImpl.current
    if (!footprint)
      throw misuse("reactronic decorator is only applicable to methods")
    footprint.options = new OptionsImpl(footprint.options.getter, footprint.options.setter, footprint.options, options, false)
    if (Log.isOn && Log.opt.write)
      Log.write("║", "  =", `${footprint.hint()}.options are changed`)
    return footprint.options
  }

  static proceedWithinGivenLaunch<T>(footprint: OperationFootprintImpl | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined
    const outer = OperationFootprintImpl.current
    try {
      OperationFootprintImpl.current = footprint
      result = func(...args)
    }
    catch (e) {
      if (footprint)
        footprint.error = e
      throw e
    }
    finally {
      OperationFootprintImpl.current = outer
    }
    return result
  }

  static why(): string {
    return OperationFootprintImpl.current?.why() ?? BOOT_CAUSE
  }

  static briefWhy(): string {
    return OperationFootprintImpl.current?.briefWhy() ?? BOOT_CAUSE
  }

  /* istanbul ignore next */
  static dependencies(): string[] {
    const l = OperationFootprintImpl.current
    return l ? l.dependencies() : ["RxSystem.dependencies should be called from inside of reactive method"]
  }

  // Internal

  private peek(args: any[] | undefined): ReuseOrRelaunchContext {
    const ctx = Changeset.current()
    const ov: ObjectVersion = ctx.lookupObjectVersion(this.ownerHandle, this.fieldKey, false)
    const footprint: OperationFootprintImpl = this.acquireFromObjectVersion(ov, args)
    const applied = this.ownerHandle.applied.data[this.fieldKey] as OperationFootprintImpl
    const isReusable = footprint.options.kind !== Kind.atomic && footprint.cause !== BOOT_CAUSE &&
      (ctx === footprint.changeset || ctx.timestamp < footprint.obsoleteSince || applied.obsoleteDueTo === undefined) &&
      (!footprint.options.observableArgs || args === undefined ||
        footprint.args.length === args.length && footprint.args.every((t, i) => t === args[i])) || ov.disposed
    return { footprint, isReusable, changeset: ctx, objectVersion: ov }
  }

  private use(): ReuseOrRelaunchContext {
    const ror = this.peek(undefined)
    Changeset.markUsed(ror.footprint, ror.objectVersion,
      this.fieldKey, this.ownerHandle, ror.footprint.options.kind, true)
    return ror
  }

  private edit(): ReuseOrRelaunchContext {
    const h = this.ownerHandle
    const fk = this.fieldKey
    const ctx = Changeset.edit()
    const ov: ObjectVersion = ctx.getEditableObjectVersion(h, fk, Meta.Handle, this)
    let footprint: OperationFootprintImpl = this.acquireFromObjectVersion(ov, undefined)
    if (footprint.changeset !== ov.changeset) {
      const newFootprint = new OperationFootprintImpl(Transaction.current, this, ov.changeset, footprint, false)
      ov.data[fk] = newFootprint.reenterOver(footprint)
      ctx.bumpBy(ov.former.objectVersion.changeset.timestamp)
      Changeset.markEdited(footprint, newFootprint, true, ov, fk, h)
      footprint = newFootprint
    }
    return { footprint, isReusable: true, changeset: ctx, objectVersion: ov }
  }

  private acquireFromObjectVersion(ov: ObjectVersion, args: any[] | undefined): OperationFootprintImpl {
    const fk = this.fieldKey
    let footprint: OperationFootprintImpl = ov.data[fk]
    if (footprint.descriptor !== this) {
      if (ov.changeset !== EMPTY_OBJECT_VERSION.changeset) {
        const hint: string = Log.isOn ? `${Dump.obj(this.ownerHandle, fk)}/init` : /* istanbul ignore next */ "OperationDescriptor/init"
        const isolation = Isolation.joinToCurrentTransaction
        // if (ov.changeset.sealed || ov.former.snapshot !== EMPTY_SNAPSHOT)
        //   isolation = Isolation.disjoinFromOuterTransaction
        footprint = Transaction.run<OperationFootprintImpl>({ hint, isolation, token: this }, (): OperationFootprintImpl => {
          const h = this.ownerHandle
          let r: ObjectVersion = Changeset.current().getObjectVersion(h, fk)
          let newFootprint = r.data[fk] as OperationFootprintImpl
          if (newFootprint.descriptor !== this) {
            r = Changeset.edit().getEditableObjectVersion(h, fk, Meta.Handle, this)
            const t = new OperationFootprintImpl(Transaction.current, this, r.changeset, newFootprint, false)
            if (args)
              t.args = args
            t.cause = BOOT_CAUSE
            r.data[fk] = t
            Changeset.markEdited(newFootprint, t, true, r, fk, h)
            newFootprint = t
          }
          return newFootprint
        })
      }
      else {
        const initialFootprint = new OperationFootprintImpl(Transaction.current, this, ov.changeset, footprint, false)
        if (args)
          initialFootprint.args = args
        initialFootprint.cause = BOOT_CAUSE
        ov.data[fk] = initialFootprint
        footprint = initialFootprint
        if (Log.isOn && Log.opt.write)
          Log.write("║", " ++", `${Dump.obj(this.ownerHandle, fk)} is initialized (revision ${ov.revision})`)
      }
    }
    return footprint
  }

  private relaunch(existing: ReuseOrRelaunchContext, isolation: Isolation, options: ReactivityOptions, token: any, args: any[] | undefined): ReuseOrRelaunchContext {
    // TODO: Cleaner implementation is needed
    const hint: string = Log.isOn ? `${Dump.obj(this.ownerHandle, this.fieldKey)}${args && args.length > 0 && (typeof args[0] === "number" || typeof args[0] === "string") ? ` - ${args[0]}` : ""}` : /* istanbul ignore next */ `${Dump.obj(this.ownerHandle, this.fieldKey)}`
    let ror = existing
    const opts = { hint, isolation, journal: options.journal, logging: options.logging, token }
    const result = Transaction.run(opts, (argsx: any[] | undefined): any => {
      if (!ror.footprint.transaction.isCanceled) { // standard launch
        ror = this.edit()
        if (Log.isOn && Log.opt.operation)
          Log.write("║", "  o", `${ror.footprint.why()}`)
        ror.footprint.proceed(this.ownerHandle.proxy, argsx)
      }
      else { // retry launch
        ror = this.peek(argsx) // re-read on retry
        if (ror.footprint.options.kind === Kind.atomic || !ror.isReusable) {
          ror = this.edit()
          if (Log.isOn && Log.opt.operation)
            Log.write("║", "  o", `${ror.footprint.why()}`)
          ror.footprint.proceed(this.ownerHandle.proxy, argsx)
        }
      }
      return ror.footprint.result
    }, args)
    ror.footprint.result = result
    return ror
  }

  private static markObsolete(self: ReactiveOperationImpl): void {
    const ror = self.peek(undefined)
    const ctx = ror.changeset
    const obsolete = ror.footprint.transaction.isFinished ? ctx.obsolete : ror.footprint.transaction.changeset.obsolete
    ror.footprint.markObsoleteDueTo(ror.footprint, self.fieldKey, EMPTY_OBJECT_VERSION.changeset, EMPTY_HANDLE, BOOT_CAUSE, ctx.timestamp, obsolete)
  }
}

// OperationFootprintImpl

class OperationFootprintImpl extends ContentFootprint implements OperationFootprint {
  static current?: OperationFootprintImpl = undefined
  static queuedReactions: Array<OperationFootprint> = []
  static deferredReactions: Array<OperationFootprintImpl> = []

  readonly margin: number
  readonly transaction: Transaction
  readonly descriptor: ReactiveOperationImpl
  readonly changeset: AbstractChangeset
  observables: Map<ContentFootprint, Subscription> | undefined
  options: OptionsImpl
  cause: string | undefined
  args: any[]
  result: any
  error: any
  started: number
  obsoleteDueTo: string | undefined
  obsoleteSince: number
  successor: OperationFootprintImpl | undefined

  constructor(transaction: Transaction, descriptor: ReactiveOperationImpl, changeset: AbstractChangeset, former: OperationFootprintImpl | OptionsImpl, clone: boolean) {
    super(undefined, 0)
    this.margin = OperationFootprintImpl.current ? OperationFootprintImpl.current.margin + 1 : 1
    this.transaction = transaction
    this.descriptor = descriptor
    this.changeset = changeset
    this.observables = new Map<ContentFootprint, Subscription>()
    if (former instanceof OperationFootprintImpl) {
      this.options = former.options
      this.cause = former.obsoleteDueTo
      this.args = former.args
      if (clone) {
        this.lastEditorChangesetId = former.lastEditorChangesetId
        this.result = former.result
        this.error = former.error
        this.started = former.started
        this.obsoleteSince = former.obsoleteSince
        this.obsoleteDueTo = former.obsoleteDueTo
        this.successor = former.successor
      }
      else {
        this.lastEditorChangesetId = changeset.id
        this.result = undefined
        this.error = undefined
        this.started = 0
        this.obsoleteSince = 0
        this.obsoleteDueTo = undefined
        this.successor = undefined
      }
    }
    else { // former: OptionsImpl
      this.lastEditorChangesetId = changeset.id
      this.options = former
      this.cause = undefined
      this.args = BOOT_ARGS
      this.result = undefined
      this.error = undefined
      this.started = 0
      this.obsoleteSince = 0
      this.obsoleteDueTo = undefined
      this.successor = undefined
    }
  }

  override get isComputed(): boolean { return true } // override
  hint(): string { return `${Dump.snapshot2(this.descriptor.ownerHandle, this.changeset, this.descriptor.fieldKey, this)}` } // override
  get order(): number { return this.options.order }

  get ["#this#"](): string {
    return `Operation: ${this.why()}`
  }

  clone(t: Transaction, cs: AbstractChangeset): ContentFootprint {
    return new OperationFootprintImpl(t, this.descriptor, cs, this, true)
  }

  why(): string {
    let cause: string
    if (this.cause)
      cause = `   ◀◀   ${this.cause}`
    else if (this.descriptor.options.kind === Kind.atomic)
      cause = "   ◀◀   operation"
    else
      cause = `   ◀◀   T${this.changeset.id}[${this.changeset.hint}]`
    return `${this.hint()}${cause}`
  }

  briefWhy(): string {
    return this.why()
  }

  dependencies(): string[] {
    throw misuse("not implemented yet")
  }

  wrap<T>(func: F<T>): F<T> {
    const wrappedForOperation: F<T> = (...args: any[]): T => {
      if (Log.isOn && Log.opt.step && this.result)
        Log.writeAs({margin2: this.margin}, "║", "‾\\", `${this.hint()} - step in  `, 0, "        │")
      const started = Date.now()
      const result = ReactiveOperationImpl.proceedWithinGivenLaunch<T>(this, func, ...args)
      const ms = Date.now() - started
      if (Log.isOn && Log.opt.step && this.result)
        Log.writeAs({margin2: this.margin}, "║", "_/", `${this.hint()} - step out `, 0, this.started > 0 ? "        │" : "")
      if (ms > Mvcc.mainThreadBlockingWarningThreshold) /* istanbul ignore next */
        Log.write("", "[!]", this.why(), ms, "    *** main thread is too busy ***")
      return result
    }
    return wrappedForOperation
  }

  proceed(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.obsoleteSince = MAX_REVISION
    if (!this.error)
      ReactiveOperationImpl.proceedWithinGivenLaunch<void>(this, OperationFootprintImpl.proceed, this, proxy)
    else
      this.result = Promise.reject(this.error)
  }

  markObsoleteDueTo(footprint: ContentFootprint, fk: FieldKey, changeset: AbstractChangeset, h: ObjectHandle, outer: string, since: number, collector: OperationFootprint[]): void {
    if (this.observables !== undefined) { // if not yet marked as obsolete
      const skip = !footprint.isComputed &&
        changeset.id === this.lastEditorChangesetId /* &&
        snapshot.changes.has(memberName) */
      if (!skip) {
        const why = `${Dump.snapshot2(h, changeset, fk, footprint)}    ◀◀    ${outer}`
        const isReactive = this.options.kind === Kind.reactive /*&& this.snapshot.data[Meta.Disposed] === undefined*/

        // Mark obsolete and unsubscribe from all (this.observables = undefined)
        this.obsoleteDueTo = why
        this.obsoleteSince = since
        if (Log.isOn && (Log.opt.obsolete || this.options.logging?.obsolete))
          Log.write(Log.opt.transaction && !Changeset.current().sealed ? "║" : " ", isReactive ? "█" : "▒",
            isReactive && changeset === EMPTY_OBJECT_VERSION.changeset
              ? `${this.hint()} is reactive and will run automatically (order ${this.options.order})`
              : `${this.hint()} is obsolete due to ${Dump.snapshot2(h, changeset, fk)} since s${since}${isReactive ? ` and will run automatically (order ${this.options.order})` : ""}`)
        this.unsubscribeFromAllObservables()

        // Stop cascade propagation on reactive function, or continue otherwise
        if (isReactive)
          collector.push(this)
        else
          this.subscribers?.forEach(s => s.markObsoleteDueTo(this, this.descriptor.fieldKey, this.changeset, this.descriptor.ownerHandle, why, since, collector))

        // Cancel own transaction if it is still in progress
        const tran = this.transaction
        if (tran.changeset === changeset) {
          // do not cancel itself
        }
        else if (!tran.isFinished && this !== footprint && !this.options.allowObsoleteToFinish) // restart after itself if canceled
          tran.cancel(new Error(`T${tran.id}[${tran.hint}] is canceled due to obsolete ${Dump.snapshot2(h, changeset, fk)} changed by T${changeset.id}[${changeset.hint}]`), null)
      }
      else if (Log.isOn && (Log.opt.obsolete || this.options.logging?.obsolete))
        Log.write(" ", "x", `${this.hint()} is not obsolete due to its own change to ${Dump.snapshot2(h, changeset, fk, footprint)}`)
    }
  }

  relaunchIfNotUpToDate(now: boolean, nothrow: boolean): void {
    const t = this.options.throttling
    const interval = Date.now() + this.started // "started" is stored as negative value after reactive function completion
    const hold = t ? t - interval : 0 // "started" is stored as negative value after reactive function completion
    if (now || hold < 0) {
      if (this.isNotUpToDate()) {
        try {
          const footprint: OperationFootprintImpl = this.descriptor.reuseOrRelaunch(false, undefined)
          if (footprint.result instanceof Promise)
            footprint.result.catch(error => {
              if (footprint.options.kind === Kind.reactive)
                misuse(`reactive function ${footprint.hint()} failed and will not run anymore: ${error}`, error)
            })
        }
        catch (e) {
          if (!nothrow)
            throw e
          else if (this.options.kind === Kind.reactive)
            misuse(`reactive ${this.hint()} failed and will not run anymore: ${e}`, e)
        }
      }
    }
    else if (t < Number.MAX_SAFE_INTEGER) {
      if (hold > 0)
        setTimeout(() => this.relaunchIfNotUpToDate(true, true), hold)
      else
        this.addToDeferredReactiveFunctions()
    }
  }

  isNotUpToDate(): boolean {
    return !this.error && (this.options.kind === Kind.atomic ||
      !this.successor || this.successor.transaction.isCanceled)
  }

  reenterOver(head: OperationFootprintImpl): this {
    let error: Error | undefined = undefined
    const opponent = head.successor
    if (opponent && !opponent.transaction.isFinished) {
      if (Log.isOn && Log.opt.obsolete)
        Log.write("║", " [!]", `${this.hint()} is trying to re-enter over ${opponent.hint()}`)
      switch (head.options.reentrance) {
        case Reentrance.preventWithError:
          if (!opponent.transaction.isCanceled)
            throw misuse(`${head.hint()} (${head.why()}) is not reentrant over ${opponent.hint()} (${opponent.why()})`)
          error = new Error(`T${this.transaction.id}[${this.transaction.hint}] is on hold/PreventWithError due to canceled T${opponent.transaction.id}[${opponent.transaction.hint}]`)
          this.transaction.cancel(error, opponent.transaction)
          break
        case Reentrance.waitAndRestart:
          error = new Error(`T${this.transaction.id}[${this.transaction.hint}] is on hold/WaitAndRestart due to active T${opponent.transaction.id}[${opponent.transaction.hint}]`)
          this.transaction.cancel(error, opponent.transaction)
          break
        case Reentrance.cancelAndWaitPrevious:
          error = new Error(`T${this.transaction.id}[${this.transaction.hint}] is on hold/CancelAndWaitPrevious due to active T${opponent.transaction.id}[${opponent.transaction.hint}]`)
          this.transaction.cancel(error, opponent.transaction)
          opponent.transaction.cancel(new Error(`T${opponent.transaction.id}[${opponent.transaction.hint}] is canceled due to re-entering T${this.transaction.id}[${this.transaction.hint}]`), null)
          break
        case Reentrance.cancelPrevious:
          opponent.transaction.cancel(new Error(`T${opponent.transaction.id}[${opponent.transaction.hint}] is canceled due to re-entering T${this.transaction.id}[${this.transaction.hint}]`), null)
          break
        case Reentrance.runSideBySide:
          break // do nothing
      }
    }
    if (!error)
      head.successor = this
    else
      this.error = error
    return this
  }

  // Internal

  private static proceed(footprint: OperationFootprintImpl, proxy: any): void {
    footprint.enter()
    try {
      if (footprint.options.getter === undefined)
        console.log("(!)")
      footprint.result = footprint.options.getter.call(proxy, ...footprint.args)
    }
    finally {
      footprint.leaveOrAsync()
    }
  }

  private enter(): void {
    if (this.options.indicator)
      this.indicatorEnter(this.options.indicator)
    if (Log.isOn && Log.opt.operation)
      Log.write("║", "‾\\", `${this.hint()} - enter`, undefined, `    [ ${Dump.obj(this.descriptor.ownerHandle, this.descriptor.fieldKey)} ]`)
    this.started = Date.now()
  }

  private leaveOrAsync(): void {
    if (this.result instanceof Promise) {
      this.result = this.result.then(
        value => {
          this.content = value
          this.leave(false, "  ⚐", "- finished  ", " OK ──┘")
          return value
        },
        error => {
          this.error = error
          this.leave(false, "  ⚐", "- finished  ", "ERR ──┘")
          throw error
        })
      if (Log.isOn) {
        if (Log.opt.operation)
          Log.write("║", "_/", `${this.hint()} - leave... `, 0, "ASYNC ──┐")
        else if (Log.opt.transaction)
          Log.write("║", "  ", `${this.why()} ...`, 0, "ASYNC")
      }
    }
    else {
      this.content = this.result
      this.leave(true, "_/", "- leave")
    }
  }

  private leave(main: boolean, op: string, message: string, highlight: string | undefined = undefined): void {
    const ms: number = Date.now() - this.started
    this.started = -this.started
    if (Log.isOn && Log.opt.operation)
      Log.write("║", `${op}`, `${this.hint()} ${message}`, ms, highlight)
    if (ms > (main ? Mvcc.mainThreadBlockingWarningThreshold : Mvcc.asyncActionDurationWarningThreshold)) /* istanbul ignore next */
      Log.write("", "[!]", this.why(), ms, main ? "    *** main thread is too busy ***" : "    *** async is too long ***")
    this.cause = undefined
    if (this.options.indicator)
      this.indicatorLeave(this.options.indicator)
    // CachedResult.freeze(this)
  }

  private indicatorEnter(mon: Indicator): void {
    const options: SnapshotOptions = {
      hint: "Indicator.enter",
      isolation: Isolation.disjoinFromOuterAndInnerTransactions,
      logging: Log.isOn && Log.opt.indicator ? undefined : Log.global }
    ReactiveOperationImpl.proceedWithinGivenLaunch<void>(undefined, Transaction.run, options,
      IndicatorImpl.enter, mon, this.transaction)
  }

  private indicatorLeave(mon: Indicator): void {
    Transaction.outside<void>(() => {
      const leave = (): void => {
        const options: SnapshotOptions = {
          hint: "Indicator.leave",
          isolation: Isolation.disjoinFromOuterAndInnerTransactions,
          logging: Log.isOn && Log.opt.indicator ? undefined : Log.DefaultLevel }
        ReactiveOperationImpl.proceedWithinGivenLaunch<void>(undefined, Transaction.run, options,
          IndicatorImpl.leave, mon, this.transaction)
      }
      this.transaction.whenFinished().then(leave, leave)
    })
  }

  private addToDeferredReactiveFunctions(): void {
    OperationFootprintImpl.deferredReactions.push(this)
    if (OperationFootprintImpl.deferredReactions.length === 1)
      setTimeout(OperationFootprintImpl.processDeferredReactions, 0)
  }

  private static processDeferredReactions(): void {
    const deferred = OperationFootprintImpl.deferredReactions
    OperationFootprintImpl.deferredReactions = [] // reset
    for (const x of deferred)
      x.relaunchIfNotUpToDate(true, true)
  }

  private static markUsed(footprint: ContentFootprint, ov: ObjectVersion, fk: FieldKey, h: ObjectHandle, kind: Kind, weak: boolean): void {
    if (kind !== Kind.atomic) {
      const subscriber: OperationFootprintImpl | undefined = OperationFootprintImpl.current // alias
      if (subscriber && subscriber.options.kind !== Kind.atomic &&
        subscriber.transaction === Transaction.current && fk !== Meta.Handle) {
        const ctx = Changeset.current()
        if (ctx !== ov.changeset) // snapshot should not bump itself
          ctx.bumpBy(ov.changeset.timestamp)
        const t = weak ? -1 : ctx.timestamp
        if (!subscriber.subscribeTo(footprint, ov, fk, h, t))
          subscriber.markObsoleteDueTo(footprint, fk, h.applied.changeset, h, BOOT_CAUSE, ctx.timestamp, ctx.obsolete)
      }
    }
  }

  private static markEdited(oldValue: any, newValue: any, edited: boolean, ov: ObjectVersion, fk: FieldKey, h: ObjectHandle): void {
    edited ? ov.changes.add(fk) : ov.changes.delete(fk)
    if (Log.isOn && Log.opt.write)
      edited ? Log.write("║", "  =", `${Dump.snapshot2(h, ov.changeset, fk)} is changed: ${valueHint(oldValue)} ▸▸ ${valueHint(newValue)}`) : Log.write("║", "  =", `${Dump.snapshot2(h, ov.changeset, fk)} is changed: ${valueHint(oldValue)} ▸▸ ${valueHint(newValue)}`, undefined, " (same as previous)")
  }

  private static tryResolveConflict(theirValue: any, ourFormerValue: any, ourValue: any): { isResolved: boolean, resolvedValue: any } {
    let isResolved = theirValue === ourFormerValue
    let resolvedValue = ourValue
    if (!isResolved) {
      if (ourValue instanceof OperationFootprintImpl && ourValue.obsoleteDueTo === undefined) {
        isResolved = true
        resolvedValue = ourValue
      }
      else if (theirValue instanceof OperationFootprintImpl && (theirValue.obsoleteDueTo === undefined || theirValue.cause === BOOT_CAUSE)) {
        isResolved = true
        resolvedValue = theirValue
      }
    }
    return { isResolved, resolvedValue }
  }

  private static propagateAllChangesThroughSubscriptions(changeset: Changeset): void {
    const since = changeset.timestamp
    const obsolete = changeset.obsolete
    changeset.items.forEach((ov: ObjectVersion, h: ObjectHandle) => {
      OperationFootprintImpl.propagateFieldChangeThroughSubscriptions(false, since, ov, Meta.Revision, h, obsolete)
      if (!ov.disposed)
        ov.changes.forEach((o, fk) => OperationFootprintImpl.propagateFieldChangeThroughSubscriptions(false, since, ov, fk, h, obsolete))
      else
        for (const fk in ov.former.objectVersion.data)
          OperationFootprintImpl.propagateFieldChangeThroughSubscriptions(true, since, ov, fk, h, obsolete)
    })
    obsolete.sort(compareReactionsByOrder)
    changeset.options.journal?.edited(
      JournalImpl.buildPatch(changeset.hint, changeset.items))
  }

  private static revokeAllSubscriptions(changeset: Changeset): void {
    changeset.items.forEach((ov: ObjectVersion, h: ObjectHandle) => {
      OperationFootprintImpl.propagateFieldChangeThroughSubscriptions(
        true, changeset.timestamp, ov, Meta.Revision, h, undefined)
      ov.changes.forEach((o, fk) => OperationFootprintImpl.propagateFieldChangeThroughSubscriptions(
        true, changeset.timestamp, ov, fk, h, undefined))
    })
  }

  private static propagateFieldChangeThroughSubscriptions(unsubscribe: boolean, timestamp: number,
    ov: ObjectVersion, fk: FieldKey, h: ObjectHandle, collector?: OperationFootprint[]): void {
    const curr = ov.data[fk]
    if (collector !== undefined) {
      // Propagate change to reactive functions
      const former = ov.former.objectVersion.data[fk]
      if (former !== undefined && former instanceof ContentFootprint) {
        const why = `T${ov.changeset.id}[${ov.changeset.hint}]`
        if (former instanceof OperationFootprintImpl) {
          if ((former.obsoleteSince === MAX_REVISION || former.obsoleteSince <= 0)) {
            former.obsoleteDueTo = why
            former.obsoleteSince = timestamp
            former.unsubscribeFromAllObservables()
          }
          const formerSuccessor = former.successor
          if (formerSuccessor !== curr) {
            if (formerSuccessor && !formerSuccessor.transaction.isFinished)
              formerSuccessor.transaction.cancel(new Error(`T${formerSuccessor.transaction.id}[${formerSuccessor.transaction.hint}] is canceled by T${ov.changeset.id}[${ov.changeset.hint}] and will not run anymore`), null)
          }
          else
            former.successor = undefined
        }
        former.subscribers?.forEach(s => {
          const t = (s as OperationFootprintImpl).transaction
          const o = t.isFinished ? collector : t.changeset.obsolete
          return s.markObsoleteDueTo(former, fk, ov.changeset, h, why, timestamp, o)
        })
      }
    }
    if (curr instanceof OperationFootprintImpl) {
      if (curr.changeset === ov.changeset && curr.observables !== undefined) {
        if (Mvcc.repetitiveUsageWarningThreshold < Number.MAX_SAFE_INTEGER) {
          curr.observables.forEach((info, v) => { // performance tracking info
            if (info.usageCount > Mvcc.repetitiveUsageWarningThreshold)
              Log.write("", "[!]", `${curr.hint()} uses ${info.memberHint} ${info.usageCount} times (consider remembering it in a local variable)`, 0, " *** WARNING ***")
          })
        }
        if (unsubscribe)
          curr.unsubscribeFromAllObservables()
      }
    }
    else if (curr instanceof ContentFootprint && curr.subscribers) {
      // // Unsubscribe from own-changed subscriptions
      // curr.reactions.forEach(o => {
      //   // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      //   o.observables!.delete(curr)
      //   if (Log.isOn && Log.opt.read)
      //     Log.write(Log.opt.transaction && !Changeset.current().sealed ? '║' : ' ', '-', `${o.hint()} is unsubscribed from own-changed ${Dump.snap(r, fk)}`)
      // })
      // curr.reactions = undefined
    }
  }

  private static enqueueReactionsToRun(reactions: Array<OperationFootprint>): void {
    const queue = OperationFootprintImpl.queuedReactions
    const isKickOff = queue.length === 0
    for (const r of reactions)
      queue.push(r)
    if (isKickOff)
      ReactiveOperationImpl.proceedWithinGivenLaunch<void>(undefined, OperationFootprintImpl.processQueuedReactions)
  }

  private static migrateContentFootprint(cf: ContentFootprint, target: Transaction): ContentFootprint {
    let result: ContentFootprint
    if (cf instanceof OperationFootprintImpl)
      result = new OperationFootprintImpl(target, cf.descriptor, target.changeset, cf, true)
    else
      result = new ContentFootprint(cf.content, cf.lastEditorChangesetId)
    // TODO: Switch subscriptions
    return result
  }

  private static processQueuedReactions(): void {
    const queue = OperationFootprintImpl.queuedReactions
    let i = 0
    while (i < queue.length) {
      const reactive = queue[i]
      reactive.relaunchIfNotUpToDate(false, true)
      i++
    }
    OperationFootprintImpl.queuedReactions = [] // reset loop
  }

  private unsubscribeFromAllObservables(): void {
    // It's critical to have no exceptions here
    this.observables?.forEach((info, value) => {
      value.subscribers!.delete(this)
      if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write(Log.opt.transaction && !Changeset.current().sealed ? "║" : " ", "-", `${this.hint()} is unsubscribed from ${info.memberHint}`)
    })
    this.observables = undefined
  }

  private subscribeTo(footprint: ContentFootprint, ov: ObjectVersion, fk: FieldKey, h: ObjectHandle, timestamp: number): boolean {
    const parent = this.transaction.changeset.parent
    const ok = OperationFootprintImpl.canSubscribeTo(footprint, ov, parent, fk, h, timestamp)
    if (ok) {
      // Performance tracking
      let times: number = 0
      if (Mvcc.repetitiveUsageWarningThreshold < Number.MAX_SAFE_INTEGER) {
        const existing = this.observables!.get(footprint)
        times = existing ? existing.usageCount + 1 : 1
      }
      if (this.observables !== undefined) {
        // Acquire storage set
        if (!footprint.subscribers)
          footprint.subscribers = new Set<OperationFootprintImpl>()
        // Two-way linking
        const subscription: Subscription = { memberHint: Dump.snapshot2(h, ov.changeset, fk), usageCount: times }
        footprint.subscribers.add(this)
        this.observables!.set(footprint, subscription)
        if (Log.isOn && (Log.opt.read || this.options.logging?.read))
          Log.write("║", "  ∞", `${this.hint()} is subscribed to ${Dump.snapshot2(h, ov.changeset, fk, footprint)}${subscription.usageCount > 1 ? ` (${subscription.usageCount} times)` : ""}`)
      }
      else if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write("║", "  x", `${this.hint()} is obsolete and is NOT subscribed to ${Dump.snapshot2(h, ov.changeset, fk, footprint)}`)
    }
    else {
      if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write("║", "  x", `${this.hint()} is NOT subscribed to already obsolete ${Dump.snapshot2(h, ov.changeset, fk, footprint)}`)
    }
    return ok // || subscription.next === r
  }

  private static canSubscribeTo(footprint: ContentFootprint, ov: ObjectVersion, parent: Changeset | undefined, fk: FieldKey, h: ObjectHandle, timestamp: number): boolean {
    const parentSnapshot = parent ? parent.lookupObjectVersion(h, fk, false) : h.applied
    const parentFootprint = parentSnapshot.data[fk]
    let result = footprint === parentFootprint || (
      !ov.changeset.sealed && ov.former.objectVersion.data[fk] === parentFootprint)
    if (result && timestamp !== -1)
      result = !(footprint instanceof OperationFootprintImpl && timestamp >= footprint.obsoleteSince)
    return result
  }

  private static createOperationDescriptor(h: ObjectHandle, fk: FieldKey, options: OptionsImpl): F<any> {
    const ctl = new ReactiveOperationImpl(h, fk)
    const operation: F<any> = (...args: any[]): any => {
      return ctl.reuseOrRelaunch(false, args).result
    }
    Meta.set(operation, Meta.Descriptor, ctl)
    return operation
  }

  private static rememberOperationOptions(proto: any, fk: FieldKey, getter: Function | undefined, setter: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<ReactivityOptions>, implicit: boolean): OptionsImpl {
    // Configure options
    const initial: any = Meta.acquire(proto, Meta.Initial)
    let footprint: OperationFootprintImpl | undefined = initial[fk]
    const ctl = footprint ? footprint.descriptor : new ReactiveOperationImpl(EMPTY_HANDLE, fk)
    const opts = footprint ? footprint.options : OptionsImpl.INITIAL
    initial[fk] = footprint = new OperationFootprintImpl(Transaction.current, ctl, EMPTY_OBJECT_VERSION.changeset, new OptionsImpl(getter, setter, opts, options, implicit), false)
    // Add to the list if it's a reactive function
    if (footprint.options.kind === Kind.reactive && footprint.options.throttling < Number.MAX_SAFE_INTEGER) {
      const reactive = Meta.acquire(proto, Meta.Reactive)
      reactive[fk] = footprint
    }
    else if (footprint.options.kind === Kind.reactive && footprint.options.throttling >= Number.MAX_SAFE_INTEGER) {
      const reactive = Meta.getFrom(proto, Meta.Reactive)
      delete reactive[fk]
    }
    return footprint.options
  }

  // static freeze(c: CachedResult): void {
  //   Utils.freezeMap(c.observables)
  //   Object.freeze(c)
  // }

  static init(): void {
    Object.freeze(BOOT_ARGS)
    Log.getMergedLoggingOptions = getMergedLoggingOptions
    Dump.valueHint = valueHint
    Changeset.markUsed = OperationFootprintImpl.markUsed // override
    Changeset.markEdited = OperationFootprintImpl.markEdited // override
    Changeset.tryResolveConflict = OperationFootprintImpl.tryResolveConflict // override
    Changeset.propagateAllChangesThroughSubscriptions = OperationFootprintImpl.propagateAllChangesThroughSubscriptions // override
    Changeset.revokeAllSubscriptions = OperationFootprintImpl.revokeAllSubscriptions // override
    Changeset.enqueueReactionsToRun = OperationFootprintImpl.enqueueReactionsToRun
    TransactionImpl.migrateContentFootprint = OperationFootprintImpl.migrateContentFootprint
    Mvcc.createOperationDescriptor = OperationFootprintImpl.createOperationDescriptor // override
    Mvcc.rememberOperationOptions = OperationFootprintImpl.rememberOperationOptions // override
    Promise.prototype.then = reactronicHookedThen // override
    try {
      Object.defineProperty(globalThis, "rWhy", {
        get: ReactiveOperationImpl.why, configurable: false, enumerable: false,
      })
      Object.defineProperty(globalThis, "rBriefWhy", {
        get: ReactiveOperationImpl.briefWhy, configurable: false, enumerable: false,
      })
    }
    catch (e) {
      // ignore
    }
    try {
      Object.defineProperty(global, "rWhy", {
        get: ReactiveOperationImpl.why, configurable: false, enumerable: false,
      })
      Object.defineProperty(global, "rBriefWhy", {
        get: ReactiveOperationImpl.briefWhy, configurable: false, enumerable: false,
      })
    }
    catch (e) {
      // ignore
    }
  }
}

// function propagationHint(cause: MemberInfo, full: boolean): string[] {
//   const result: string[] = []
//   let observable: Observable = cause.snapshot.data[cause.memberName]
//   while (observable instanceof Operation && observable.obsoleteDueTo) {
//     full && result.push(Dump.snap(cause.snapshot, cause.memberName))
//     cause = observable.obsoleteDueTo
//     observable = cause.snapshot.data[cause.memberName]
//   }
//   result.push(Dump.snap(cause.snapshot, cause.memberName))
//   full && result.push(cause.snapshot.snapshot.hint)
//   return result
// }

function valueHint(value: any): string {
  let result: string = ""
  if (Array.isArray(value))
    result = `Array(${value.length})`
  else if (value instanceof Set)
    result = `Set(${value.size})`
  else if (value instanceof Map)
    result = `Map(${value.size})`
  else if (value instanceof OperationFootprintImpl)
    result = `#${value.descriptor.ownerHandle.id}t${value.changeset.id}s${value.changeset.timestamp}${value.lastEditorChangesetId !== undefined && value.lastEditorChangesetId !== 0 ? `t${value.lastEditorChangesetId}` : ""}`
  else if (value === Meta.Undefined)
    result = "undefined"
  else if (typeof(value) === "string")
    result = `"${value.toString().slice(0, 20)}${value.length > 20 ? "..." : ""}"`
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 40)
  else
    result = "undefined"
  return result
}

function getMergedLoggingOptions(local: Partial<LoggingOptions> | undefined): LoggingOptions {
  const t = Transaction.current
  let res = Log.merge(t.options.logging, t.id > 1 ? 31 + t.id % 6 : 37, t.id > 1 ? `T${t.id}` : `-${Changeset.idGen.toString().replace(/[0-9]/g, "-")}`, Log.global)
  res = Log.merge({margin1: t.margin}, undefined, undefined, res)
  if (OperationFootprintImpl.current)
    res = Log.merge({margin2: OperationFootprintImpl.current.margin}, undefined, undefined, res)
  if (local)
    res = Log.merge(local, undefined, undefined, res)
  return res
}

const ORIGINAL_PROMISE_THEN = Promise.prototype.then

function reactronicHookedThen(this: any,
  resolve?: ((value: any) => any | PromiseLike<any>) | undefined | null,
  reject?: ((reason: any) => never | PromiseLike<never>) | undefined | null): Promise<any | never>
{
  const tran = Transaction.current
  if (!tran.isFinished) {
    if (!resolve)
      resolve = resolveReturn
    if (!reject)
      reject = rejectRethrow
    const footprint = OperationFootprintImpl.current
    if (footprint) {
      resolve = footprint.wrap(resolve)
      reject = footprint.wrap(reject)
    }
    resolve = tran.wrapAsPending(resolve, false)
    reject = tran.wrapAsPending(reject, true)
  }
  return ORIGINAL_PROMISE_THEN.call(this, resolve, reject)
}

function compareReactionsByOrder(r1: OperationFootprint, r2: OperationFootprint): number {
  return r1.order - r2.order
}

/* istanbul ignore next */
export function resolveReturn(value: any): any {
  return value
}

/* istanbul ignore next */
export function rejectRethrow(error: any): never {
  throw error
}

OperationFootprintImpl.init()
