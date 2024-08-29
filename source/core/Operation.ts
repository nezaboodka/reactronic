// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2024 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from "../util/Utils.js"
import { Log, misuse } from "../util/Dbg.js"
import { Operation, MemberOptions, Kind, Reentrance, LoggingOptions, SnapshotOptions, Isolation } from "../Options.js"
import { ObjectVersion, FieldKey, ObjectHandle, FieldVersion, Observer, Subscription, Meta, AbstractChangeset } from "./Data.js"
import { Changeset, Dump, EMPTY_OBJECT_VERSION, MAX_REVISION } from "./Changeset.js"
import { Transaction, TransactionImpl } from "./Transaction.js"
import { Indicator, IndicatorImpl } from "./Indicator.js"
import { Mvcc, OptionsImpl } from "./Mvcc.js"
import { JournalImpl } from "./Journal.js"

const BOOT_ARGS: any[] = []
const BOOT_CAUSE = "<boot>"
const EMPTY_HANDLE = new ObjectHandle(undefined, undefined, Mvcc.observable, EMPTY_OBJECT_VERSION, "<boot>")

type ReuseOrRelaunchContext = {
  readonly launch: Launch
  readonly isUpToDate: boolean
  readonly changeset: Changeset
  readonly objectVersion: ObjectVersion
}

export class OperationImpl implements Operation<any> {
  readonly ownerHandle: ObjectHandle
  readonly fieldKey: FieldKey

  configure(options: Partial<MemberOptions>): MemberOptions { return OperationImpl.configureImpl(this, options) }
  get options(): MemberOptions { return this.peek(undefined).launch.options }
  get unobs(): any { return this.peek(undefined).launch.content }
  get args(): ReadonlyArray<any> { return this.use().launch.args }
  get result(): any { return this.reuseOrRelaunch(true, undefined).content }
  get error(): boolean { return this.use().launch.error }
  get stamp(): number { return this.use().objectVersion.changeset.timestamp }
  get isUpToDate(): boolean { return this.use().isUpToDate }
  markObsolete(): void { Transaction.run({ hint: Log.isOn ? `markObsolete(${Dump.obj(this.ownerHandle, this.fieldKey)})` : "markObsolete()" }, OperationImpl.markObsolete, this) }
  pullLastResult(args?: any[]): any { return this.reuseOrRelaunch(true, args).content }

  constructor(h: ObjectHandle, fk: FieldKey) {
    this.ownerHandle = h
    this.fieldKey = fk
  }

  reuseOrRelaunch(weak: boolean, args: any[] | undefined): Launch {
    let ror: ReuseOrRelaunchContext = this.peek(args)
    const ctx = ror.changeset
    const launch: Launch = ror.launch
    const opts = launch.options
    if (!ror.isUpToDate && !ror.objectVersion.disposed
      && (!weak || launch.cause === BOOT_CAUSE || !launch.successor ||
        launch.successor.transaction.isFinished)) {
      // transaction => joinToCurrent
      // reaction => joinAsNested
      // cached => joinToCurrent
      // weak => disjoinFromOuterTransaction
      const isolation: Isolation = !weak ? opts.isolation : Isolation.disjoinFromOuterTransaction
      const token = opts.noSideEffects ? this : undefined
      const ror2 = this.relaunch(ror, isolation, opts, token, args)
      const ctx2 = ror2.launch.changeset
      if (!weak || ctx === ctx2 || (ctx2.sealed && ctx.timestamp >= ctx2.timestamp))
        ror = ror2
    }
    else if (Log.isOn && Log.opt.operation && (opts.logging === undefined ||
      opts.logging.operation === undefined || opts.logging.operation === true))
      Log.write(Transaction.current.isFinished ? "" : "║", " (=)",
        `${Dump.snapshot2(ror.launch.operation.ownerHandle, ror.changeset, this.fieldKey)} result is reused from T${ror.launch.transaction.id}[${ror.launch.transaction.hint}]`)
    const t = ror.launch
    Changeset.markUsed(t, ror.objectVersion, this.fieldKey, this.ownerHandle, t.options.kind, weak)
    return t
  }

  static getControllerOf(method: F<any>): Operation<any> {
    const ctl = Meta.get<Operation<any> | undefined>(method, Meta.Controller)
    if (!ctl)
      throw misuse(`given method is not decorated as reactronic one: ${method.name}`)
    return ctl
  }

  static configureImpl(self: OperationImpl | undefined, options: Partial<MemberOptions>): MemberOptions {
    let launch: Launch | undefined
    if (self)
      launch = self.edit().launch
    else
      launch = Launch.current
    if (!launch)
      throw misuse("reactronic decorator is only applicable to methods")
    launch.options = new OptionsImpl(launch.options.getter, launch.options.setter, launch.options, options, false)
    if (Log.isOn && Log.opt.write)
      Log.write("║", "  =", `${launch.hint()}.options are changed`)
    return launch.options
  }

  static proceedWithinGivenLaunch<T>(launch: Launch | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined
    const outer = Launch.current
    try {
      Launch.current = launch
      result = func(...args)
    }
    catch (e) {
      if (launch)
        launch.error = e
      throw e
    }
    finally {
      Launch.current = outer
    }
    return result
  }

  static why(): string {
    return Launch.current?.why() ?? BOOT_CAUSE
  }

  static briefWhy(): string {
    return Launch.current?.briefWhy() ?? BOOT_CAUSE
  }

  /* istanbul ignore next */
  static dependencies(): string[] {
    const l = Launch.current
    return l ? l.dependencies() : ["RxSystem.dependencies should be called from inside of reactive method"]
  }

  // Internal

  private peek(args: any[] | undefined): ReuseOrRelaunchContext {
    const ctx = Changeset.current()
    const ov: ObjectVersion = ctx.lookupObjectVersion(this.ownerHandle, this.fieldKey, false)
    const launch: Launch = this.acquireFromObjectVersion(ov, args)
    const isValid = launch.options.kind !== Kind.transactional && launch.cause !== BOOT_CAUSE &&
      (ctx === launch.changeset || ctx.timestamp < launch.obsoleteSince) &&
      (!launch.options.triggeringArgs || args === undefined ||
        launch.args.length === args.length && launch.args.every((t, i) => t === args[i])) || ov.disposed
    return { launch, isUpToDate: isValid, changeset: ctx, objectVersion: ov }
  }

  private use(): ReuseOrRelaunchContext {
    const ror = this.peek(undefined)
    Changeset.markUsed(ror.launch, ror.objectVersion,
      this.fieldKey, this.ownerHandle, ror.launch.options.kind, true)
    return ror
  }

  private edit(): ReuseOrRelaunchContext {
    const h = this.ownerHandle
    const fk = this.fieldKey
    const ctx = Changeset.edit()
    const ov: ObjectVersion = ctx.getEditableObjectVersion(h, fk, Meta.Handle, this)
    let launch: Launch = this.acquireFromObjectVersion(ov, undefined)
    if (launch.changeset !== ov.changeset) {
      const relaunch = new Launch(Transaction.current, this, ov.changeset, launch, false)
      ov.data[fk] = relaunch.reenterOver(launch)
      ctx.bumpBy(ov.former.objectVersion.changeset.timestamp)
      Changeset.markEdited(launch, relaunch, true, ov, fk, h)
      launch = relaunch
    }
    return { launch, isUpToDate: true, changeset: ctx, objectVersion: ov }
  }

  private acquireFromObjectVersion(ov: ObjectVersion, args: any[] | undefined): Launch {
    const fk = this.fieldKey
    let launch: Launch = ov.data[fk]
    if (launch.operation !== this) {
      if (ov.changeset !== EMPTY_OBJECT_VERSION.changeset) {
        const hint: string = Log.isOn ? `${Dump.obj(this.ownerHandle, fk)}/init` : /* istanbul ignore next */ "MethodController/init"
        const isolation = Isolation.joinToCurrentTransaction
        // if (ov.changeset.sealed || ov.former.snapshot !== EMPTY_SNAPSHOT)
        //   isolation = Isolation.disjoinFromOuterTransaction
        launch = Transaction.run<Launch>({ hint, isolation, token: this }, (): Launch => {
          const h = this.ownerHandle
          let r: ObjectVersion = Changeset.current().getObjectVersion(h, fk)
          let relaunch = r.data[fk] as Launch
          if (relaunch.operation !== this) {
            r = Changeset.edit().getEditableObjectVersion(h, fk, Meta.Handle, this)
            const t = new Launch(Transaction.current, this, r.changeset, relaunch, false)
            if (args)
              t.args = args
            t.cause = BOOT_CAUSE
            r.data[fk] = t
            Changeset.markEdited(relaunch, t, true, r, fk, h)
            relaunch = t
          }
          return relaunch
        })
      }
      else {
        const initialLaunch = new Launch(Transaction.current, this, ov.changeset, launch, false)
        if (args)
          initialLaunch.args = args
        initialLaunch.cause = BOOT_CAUSE
        ov.data[fk] = initialLaunch
        launch = initialLaunch
        if (Log.isOn && Log.opt.write)
          Log.write("║", " ++", `${Dump.obj(this.ownerHandle, fk)} is initialized (revision ${ov.revision})`)
      }
    }
    return launch
  }

  private relaunch(existing: ReuseOrRelaunchContext, isolation: Isolation, options: MemberOptions, token: any, args: any[] | undefined): ReuseOrRelaunchContext {
    // TODO: Cleaner implementation is needed
    const hint: string = Log.isOn ? `${Dump.obj(this.ownerHandle, this.fieldKey)}${args && args.length > 0 && (typeof args[0] === "number" || typeof args[0] === "string") ? ` - ${args[0]}` : ""}` : /* istanbul ignore next */ `${Dump.obj(this.ownerHandle, this.fieldKey)}`
    let ror = existing
    const opts = { hint, isolation, journal: options.journal, logging: options.logging, token }
    const result = Transaction.run(opts, (argsx: any[] | undefined): any => {
      if (!ror.launch.transaction.isCanceled) { // standard launch
        ror = this.edit()
        if (Log.isOn && Log.opt.operation)
          Log.write("║", "  o", `${ror.launch.why()}`)
        ror.launch.proceed(this.ownerHandle.proxy, argsx)
      }
      else { // retry launch
        ror = this.peek(argsx) // re-read on retry
        if (ror.launch.options.kind === Kind.transactional || !ror.isUpToDate) {
          ror = this.edit()
          if (Log.isOn && Log.opt.operation)
            Log.write("║", "  o", `${ror.launch.why()}`)
          ror.launch.proceed(this.ownerHandle.proxy, argsx)
        }
      }
      return ror.launch.result
    }, args)
    ror.launch.result = result
    return ror
  }

  private static markObsolete(self: OperationImpl): void {
    const ror = self.peek(undefined)
    const ctx = ror.changeset
    ror.launch.markObsoleteDueTo(ror.launch, self.fieldKey, EMPTY_OBJECT_VERSION.changeset, EMPTY_HANDLE, BOOT_CAUSE, ctx.timestamp, ctx.obsolete)
  }
}

// Operation Launch

class Launch extends FieldVersion implements Observer {
  static current?: Launch = undefined
  static queuedReactiveOperations: Array<Observer> = []
  static deferredReactiveOperations: Array<Launch> = []

  readonly margin: number
  readonly transaction: Transaction
  readonly operation: OperationImpl
  readonly changeset: AbstractChangeset
  observables: Map<FieldVersion, Subscription> | undefined
  options: OptionsImpl
  cause: string | undefined
  args: any[]
  result: any
  error: any
  started: number
  obsoleteDueTo: string | undefined
  obsoleteSince: number
  successor: Launch | undefined

  constructor(transaction: Transaction, operation: OperationImpl, changeset: AbstractChangeset, former: Launch | OptionsImpl, clone: boolean) {
    super(undefined, 0)
    this.margin = Launch.current ? Launch.current.margin + 1 : 1
    this.transaction = transaction
    this.operation = operation
    this.changeset = changeset
    this.observables = new Map<FieldVersion, Subscription>()
    if (former instanceof Launch) {
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

  get isLaunch(): boolean { return true } // override
  hint(): string { return `${Dump.snapshot2(this.operation.ownerHandle, this.changeset, this.operation.fieldKey)}` } // override
  get order(): number { return this.options.order }

  get ["#this#"](): string {
    return `Operation: ${this.why()}`
  }

  clone(t: Transaction, cs: AbstractChangeset): FieldVersion {
    return new Launch(t, this.operation, cs, this, true)
  }

  why(): string {
    let cause: string
    if (this.cause)
      cause = `   ◀◀   ${this.cause}`
    else if (this.operation.options.kind === Kind.transactional)
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
      const result = OperationImpl.proceedWithinGivenLaunch<T>(this, func, ...args)
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
      OperationImpl.proceedWithinGivenLaunch<void>(this, Launch.proceed, this, proxy)
    else
      this.result = Promise.reject(this.error)
  }

  markObsoleteDueTo(observable: FieldVersion, fk: FieldKey, changeset: AbstractChangeset, h: ObjectHandle, outer: string, since: number, obsolete: Observer[]): void {
    if (this.observables !== undefined) { // if not yet marked as obsolete
      const skip = !observable.isLaunch &&
        changeset === this.changeset /* &&
        snapshot.changes.has(memberName) */
      if (!skip) {
        const why = `${Dump.snapshot2(h, changeset, fk, observable)}    ◀◀    ${outer}`
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
          obsolete.push(this)
        else
          this.observers?.forEach(s => s.markObsoleteDueTo(this, this.operation.fieldKey, this.changeset, this.operation.ownerHandle, why, since, obsolete))

        // Cancel own transaction if it is still in progress
        const tran = this.transaction
        if (tran.changeset === changeset) {
          // do not cancel itself
        }
        else if (!tran.isFinished && this !== observable) // restart after itself if canceled
          tran.cancel(new Error(`T${tran.id}[${tran.hint}] is canceled due to obsolete ${Dump.snapshot2(h, changeset, fk)} changed by T${changeset.id}[${changeset.hint}]`), null)
      }
      else if (Log.isOn && (Log.opt.obsolete || this.options.logging?.obsolete))
        Log.write(" ", "x", `${this.hint()} is not obsolete due to its own change to ${Dump.snapshot2(h, changeset, fk)}`)
    }
  }

  relaunchIfNotUpToDate(now: boolean, nothrow: boolean): void {
    const t = this.options.throttling
    const interval = Date.now() + this.started // "started" is stored as negative value after reactive function completion
    const hold = t ? t - interval : 0 // "started" is stored as negative value after reactive function completion
    if (now || hold < 0) {
      if (this.isNotUpToDate()) {
        try {
          const launch: Launch = this.operation.reuseOrRelaunch(false, undefined)
          if (launch.result instanceof Promise)
            launch.result.catch(error => {
              if (launch.options.kind === Kind.reactive)
                misuse(`reactive function ${launch.hint()} failed and will not run anymore: ${error}`, error)
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
    return !this.error && (this.options.kind === Kind.transactional ||
      !this.successor || this.successor.transaction.isCanceled)
  }

  reenterOver(head: Launch): this {
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

  private static proceed(launch: Launch, proxy: any): void {
    launch.enter()
    try {
      if (launch.options.getter === undefined)
        console.log("(!)")
      launch.result = launch.options.getter.call(proxy, ...launch.args)
    }
    finally {
      launch.leaveOrAsync()
    }
  }

  private enter(): void {
    if (this.options.indicator)
      this.indicatorEnter(this.options.indicator)
    if (Log.isOn && Log.opt.operation)
      Log.write("║", "‾\\", `${this.hint()} - enter`, undefined, `    [ ${Dump.obj(this.operation.ownerHandle, this.operation.fieldKey)} ]`)
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
    OperationImpl.proceedWithinGivenLaunch<void>(undefined, Transaction.run, options,
      IndicatorImpl.enter, mon, this.transaction)
  }

  private indicatorLeave(mon: Indicator): void {
    Transaction.outside<void>(() => {
      const leave = (): void => {
        const options: SnapshotOptions = {
          hint: "Indicator.leave",
          isolation: Isolation.disjoinFromOuterAndInnerTransactions,
          logging: Log.isOn && Log.opt.indicator ? undefined : Log.DefaultLevel }
        OperationImpl.proceedWithinGivenLaunch<void>(undefined, Transaction.run, options,
          IndicatorImpl.leave, mon, this.transaction)
      }
      this.transaction.whenFinished().then(leave, leave)
    })
  }

  private addToDeferredReactiveFunctions(): void {
    Launch.deferredReactiveOperations.push(this)
    if (Launch.deferredReactiveOperations.length === 1)
      setTimeout(Launch.processDeferredReactiveFunctions, 0)
  }

  private static processDeferredReactiveFunctions(): void {
    const deferred = Launch.deferredReactiveOperations
    Launch.deferredReactiveOperations = [] // reset
    for (const x of deferred)
      x.relaunchIfNotUpToDate(true, true)
  }

  private static markUsed(observable: FieldVersion, ov: ObjectVersion, fk: FieldKey, h: ObjectHandle, kind: Kind, weak: boolean): void {
    if (kind !== Kind.transactional) {
      const launch: Launch | undefined = Launch.current // alias
      if (launch && launch.options.kind !== Kind.transactional &&
        launch.transaction === Transaction.current && fk !== Meta.Handle) {
        const ctx = Changeset.current()
        if (ctx !== ov.changeset) // snapshot should not bump itself
          ctx.bumpBy(ov.changeset.timestamp)
        const t = weak ? -1 : ctx.timestamp
        if (!launch.subscribeTo(observable, ov, fk, h, t))
          launch.markObsoleteDueTo(observable, fk, h.applied.changeset, h, BOOT_CAUSE, ctx.timestamp, ctx.obsolete)
      }
    }
  }

  private static markEdited(oldValue: any, newValue: any, edited: boolean, ov: ObjectVersion, fk: FieldKey, h: ObjectHandle): void {
    edited ? ov.changes.add(fk) : ov.changes.delete(fk)
    if (Log.isOn && Log.opt.write)
      edited ? Log.write("║", "  =", `${Dump.snapshot2(h, ov.changeset, fk)} is changed: ${valueHint(oldValue)} ▸▸ ${valueHint(newValue)}`) : Log.write("║", "  =", `${Dump.snapshot2(h, ov.changeset, fk)} is changed: ${valueHint(oldValue)} ▸▸ ${valueHint(newValue)}`, undefined, " (same as previous)")
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof Launch && oldValue.cause !== BOOT_CAUSE
    return result
  }

  private static propagateAllChangesThroughSubscriptions(changeset: Changeset): void {
    const since = changeset.timestamp
    const obsolete = changeset.obsolete
    changeset.items.forEach((ov: ObjectVersion, h: ObjectHandle) => {
      Launch.propagateFieldChangeThroughSubscriptions(false, since, ov, Meta.Revision, h, obsolete)
      if (!ov.disposed)
        ov.changes.forEach((o, fk) => Launch.propagateFieldChangeThroughSubscriptions(false, since, ov, fk, h, obsolete))
      else
        for (const fk in ov.former.objectVersion.data)
          Launch.propagateFieldChangeThroughSubscriptions(true, since, ov, fk, h, obsolete)
    })
    obsolete.sort(compareObserversByOrder)
    changeset.options.journal?.edited(
      JournalImpl.buildPatch(changeset.hint, changeset.items))
  }

  private static revokeAllSubscriptions(changeset: Changeset): void {
    changeset.items.forEach((ov: ObjectVersion, h: ObjectHandle) => {
      Launch.propagateFieldChangeThroughSubscriptions(
        true, changeset.timestamp, ov, Meta.Revision, h, undefined)
      ov.changes.forEach((o, fk) => Launch.propagateFieldChangeThroughSubscriptions(
        true, changeset.timestamp, ov, fk, h, undefined))
    })
  }

  private static propagateFieldChangeThroughSubscriptions(unsubscribe: boolean, timestamp: number,
    ov: ObjectVersion, fk: FieldKey, h: ObjectHandle, obsolete?: Observer[]): void {
    const curr = ov.data[fk]
    if (obsolete !== undefined) {
      // Propagate change to reactive functions
      const former = ov.former.objectVersion.data[fk]
      if (former !== undefined && former instanceof FieldVersion) {
        const why = `T${ov.changeset.id}[${ov.changeset.hint}]`
        if (former instanceof Launch) {
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
        former.observers?.forEach(s =>
          s.markObsoleteDueTo(former, fk, ov.changeset, h, why, timestamp, obsolete))
      }
    }
    if (curr instanceof Launch) {
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
    else if (curr instanceof FieldVersion && curr.observers) {
      // // Unsubscribe from own-changed subscriptions
      // curr.observers.forEach(o => {
      //   // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      //   o.observables!.delete(curr)
      //   if (Log.isOn && Log.opt.read)
      //     Log.write(Log.opt.transaction && !Changeset.current().sealed ? '║' : ' ', '-', `${o.hint()} is unsubscribed from own-changed ${Dump.snap(r, fk)}`)
      // })
      // curr.observers = undefined
    }
  }

  private static enqueueReactiveFunctionsToRun(reactive: Array<Observer>): void {
    const queue = Launch.queuedReactiveOperations
    const isReactiveLoopRequired = queue.length === 0
    for (const r of reactive)
      queue.push(r)
    if (isReactiveLoopRequired)
      OperationImpl.proceedWithinGivenLaunch<void>(undefined, Launch.processQueuedReactiveOperations)
  }

  private static migrateFieldVersion(fv: FieldVersion, target: Transaction): FieldVersion {
    let result: FieldVersion
    if (fv instanceof Launch)
      result = new Launch(target, fv.operation, target.changeset, fv, true)
    else
      result = new FieldVersion(fv.content, fv.lastEditorChangesetId)
    // TODO: Switch subscriptions
    return result
  }

  private static processQueuedReactiveOperations(): void {
    const queue = Launch.queuedReactiveOperations
    let i = 0
    while (i < queue.length) {
      const reactive = queue[i]
      reactive.relaunchIfNotUpToDate(false, true)
      i++
    }
    Launch.queuedReactiveOperations = [] // reset loop
  }

  private unsubscribeFromAllObservables(): void {
    // It's critical to have no exceptions here
    this.observables?.forEach((info, value) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value.observers!.delete(this)
      if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write(Log.opt.transaction && !Changeset.current().sealed ? "║" : " ", "-", `${this.hint()} is unsubscribed from ${info.memberHint}`)
    })
    this.observables = undefined
  }

  private subscribeTo(observable: FieldVersion, ov: ObjectVersion, fk: FieldKey, h: ObjectHandle, timestamp: number): boolean {
    const parent = this.transaction.changeset.parent
    const ok = Launch.canSubscribeTo(observable, ov, parent, fk, h, timestamp)
    if (ok) {
      // Performance tracking
      let times: number = 0
      if (Mvcc.repetitiveUsageWarningThreshold < Number.MAX_SAFE_INTEGER) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const existing = this.observables!.get(observable)
        times = existing ? existing.usageCount + 1 : 1
      }
      if (this.observables !== undefined) {
        // Acquire observers
        if (!observable.observers)
          observable.observers = new Set<Launch>()
        // Two-way linking
        const subscription: Subscription = { memberHint: Dump.snapshot2(h, ov.changeset, fk), usageCount: times }
        observable.observers.add(this)
        this.observables!.set(observable, subscription)
        if (Log.isOn && (Log.opt.read || this.options.logging?.read))
          Log.write("║", "  ∞", `${this.hint()} is subscribed to ${Dump.snapshot2(h, ov.changeset, fk)}${subscription.usageCount > 1 ? ` (${subscription.usageCount} times)` : ""}`)
      }
      else if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write("║", "  x", `${this.hint()} is obsolete and is NOT subscribed to ${Dump.snapshot2(h, ov.changeset, fk)}`)
    }
    else {
      if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write("║", "  x", `${this.hint()} is NOT subscribed to already obsolete ${Dump.snapshot2(h, ov.changeset, fk)}`)
    }
    return ok // || subscription.next === r
  }

  private static canSubscribeTo(observable: FieldVersion, ov: ObjectVersion, parent: Changeset | undefined, fk: FieldKey, h: ObjectHandle, timestamp: number): boolean {
    const parentSnapshot = parent ? parent.lookupObjectVersion(h, fk, false) : h.applied
    const observableParent = parentSnapshot.data[fk]
    let result = observable === observableParent || (
      !ov.changeset.sealed && ov.former.objectVersion.data[fk] === observableParent)
    if (result && timestamp !== -1)
      result = !(observable instanceof Launch && timestamp >= observable.obsoleteSince)
    return result
  }

  private static createOperation(h: ObjectHandle, fk: FieldKey, options: OptionsImpl): F<any> {
    const rx = new OperationImpl(h, fk)
    const operation: F<any> = (...args: any[]): any => {
      return rx.reuseOrRelaunch(false, args).result
    }
    Meta.set(operation, Meta.Controller, rx)
    return operation
  }

  private static rememberOperationOptions(proto: any, fk: FieldKey, getter: Function | undefined, setter: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<MemberOptions>, implicit: boolean): OptionsImpl {
    // Configure options
    const initial: any = Meta.acquire(proto, Meta.Initial)
    let launch: Launch | undefined = initial[fk]
    const rx = launch ? launch.operation : new OperationImpl(EMPTY_HANDLE, fk)
    const opts = launch ? launch.options : OptionsImpl.INITIAL
    initial[fk] = launch = new Launch(Transaction.current, rx, EMPTY_OBJECT_VERSION.changeset, new OptionsImpl(getter, setter, opts, options, implicit), false)
    // Add to the list if it's a reactive function
    if (launch.options.kind === Kind.reactive && launch.options.throttling < Number.MAX_SAFE_INTEGER) {
      const reactive = Meta.acquire(proto, Meta.Reactive)
      reactive[fk] = launch
    }
    else if (launch.options.kind === Kind.reactive && launch.options.throttling >= Number.MAX_SAFE_INTEGER) {
      const reactive = Meta.getFrom(proto, Meta.Reactive)
      delete reactive[fk]
    }
    return launch.options
  }

  // static freeze(c: CachedResult): void {
  //   Utils.freezeMap(c.observables)
  //   Object.freeze(c)
  // }

  static init(): void {
    Object.freeze(BOOT_ARGS)
    Log.getMergedLoggingOptions = getMergedLoggingOptions
    Dump.valueHint = valueHint
    Changeset.markUsed = Launch.markUsed // override
    Changeset.markEdited = Launch.markEdited // override
    Changeset.isConflicting = Launch.isConflicting // override
    Changeset.propagateAllChangesThroughSubscriptions = Launch.propagateAllChangesThroughSubscriptions // override
    Changeset.revokeAllSubscriptions = Launch.revokeAllSubscriptions // override
    Changeset.enqueueReactiveFunctionsToRun = Launch.enqueueReactiveFunctionsToRun
    TransactionImpl.migrateFieldVersion = Launch.migrateFieldVersion
    Mvcc.createOperation = Launch.createOperation // override
    Mvcc.rememberOperationOptions = Launch.rememberOperationOptions // override
    Promise.prototype.then = reactronicHookedThen // override
    try {
      Object.defineProperty(globalThis, "rWhy", {
        get: OperationImpl.why, configurable: false, enumerable: false,
      })
      Object.defineProperty(globalThis, "rBriefWhy", {
        get: OperationImpl.briefWhy, configurable: false, enumerable: false,
      })
    }
    catch (e) {
      // ignore
    }
    try {
      Object.defineProperty(global, "rWhy", {
        get: OperationImpl.why, configurable: false, enumerable: false,
      })
      Object.defineProperty(global, "rBriefWhy", {
        get: OperationImpl.briefWhy, configurable: false, enumerable: false,
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
  else if (value instanceof Launch)
    result = `#${value.operation.ownerHandle.id}t${value.changeset.id}s${value.changeset.timestamp}${value.lastEditorChangesetId !== undefined && value.lastEditorChangesetId !== 0 ? `t${value.lastEditorChangesetId}` : ""}`
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
  if (Launch.current)
    res = Log.merge({margin2: Launch.current.margin}, undefined, undefined, res)
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
    const launch = Launch.current
    if (launch) {
      resolve = launch.wrap(resolve)
      reject = launch.wrap(reject)
    }
    resolve = tran.wrap(resolve, false)
    reject = tran.wrap(reject, true)
  }
  return ORIGINAL_PROMISE_THEN.call(this, resolve, reject)
}

function compareObserversByOrder(a: Observer, b: Observer): number {
  return a.order - b.order
}

/* istanbul ignore next */
export function resolveReturn(value: any): any {
  return value
}

/* istanbul ignore next */
export function rejectRethrow(error: any): never {
  throw error
}

Launch.init()
