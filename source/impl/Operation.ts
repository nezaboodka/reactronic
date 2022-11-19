// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from '../util/Utils'
import { Log, misuse } from '../util/Dbg'
import { MemberOptions, Kind, Reentrance, LoggingOptions, SnapshotOptions } from '../Options'
import { Controller } from '../Controller'
import { ObjectSnapshot, MemberName, ObjectHandle, Observable, Observer, SeparationMode, Subscription, Meta, AbstractChangeset } from './Data'
import { Changeset, Dump, EMPTY_SNAPSHOT, MAX_REVISION } from './Changeset'
import { Transaction } from './Transaction'
import { Monitor, MonitorImpl } from './Monitor'
import { Mvcc, OptionsImpl } from './Mvcc'
import { JournalImpl } from './Journal'

const BOOT_ARGS: any[] = []
const BOOT_CAUSE = '<boot>'
const EMPTY_HANDLE = new ObjectHandle(undefined, undefined, Mvcc.observable, EMPTY_SNAPSHOT, '<boot>')

type OperationContext = {
  readonly operation: Operation
  readonly isUpToDate: boolean
  readonly changeset: Changeset
  readonly snapshot: ObjectSnapshot
}

export class OperationController extends Controller<any> {
  readonly objectHandle: ObjectHandle
  readonly memberName: MemberName

  configure(options: Partial<MemberOptions>): MemberOptions { return OperationController.configureImpl(this, options) }
  get options(): MemberOptions { return this.peek(undefined).operation.options }
  get unobservable(): any { return this.peek(undefined).operation.content }
  get args(): ReadonlyArray<any> { return this.use().operation.args }
  get result(): any { return this.useOrRun(true, undefined).content }
  get error(): boolean { return this.use().operation.error }
  get stamp(): number { return this.use().snapshot.changeset.timestamp }
  get isUpToDate(): boolean { return this.use().isUpToDate }
  markObsolete(): void { Transaction.run({ hint: Log.isOn ? `markObsolete(${Dump.obj(this.objectHandle, this.memberName)})` : 'markObsolete()' }, OperationController.markObsolete, this) }
  pullLastResult(args?: any[]): any { return this.useOrRun(true, args).content }

  constructor(h: ObjectHandle, m: MemberName) {
    super()
    this.objectHandle = h
    this.memberName = m
  }

  useOrRun(weak: boolean, args: any[] | undefined): Operation {
    let oc: OperationContext = this.peek(args)
    const ctx = oc.changeset
    const op: Operation = oc.operation
    const opts = op.options
    if (!oc.isUpToDate && !oc.snapshot.disposed
      && (!weak || op.cause === BOOT_CAUSE || !op.successor ||
        op.successor.transaction.isFinished)) {
      const outerOpts = Operation.current?.options
      const separation = weak || opts.separation !== false || opts.kind === Kind.Reactive ||
        (opts.kind === Kind.Transactional && outerOpts && (outerOpts.noSideEffects || outerOpts.kind === Kind.Cached)) ||
        (opts.kind === Kind.Cached && (oc.snapshot.changeset.sealed ||
          oc.snapshot.former.snapshot !== EMPTY_SNAPSHOT))
      const token = opts.noSideEffects ? this : undefined
      const oc2 = this.run(oc, separation, opts, token, args)
      const ctx2 = oc2.operation.changeset
      if (!weak || ctx === ctx2 || (ctx2.sealed && ctx.timestamp >= ctx2.timestamp))
        oc = oc2
    }
    else if (Log.isOn && Log.opt.operation && (opts.logging === undefined ||
      opts.logging.operation === undefined || opts.logging.operation === true))
      Log.write(Transaction.current.isFinished ? '' : '║', ' (=)',
        `${Dump.snapshot2(oc.operation.controller.objectHandle, oc.changeset, this.memberName)} result is reused from T${oc.operation.transaction.id}[${oc.operation.transaction.hint}]`)
    const t = oc.operation
    Changeset.markUsed(t, oc.snapshot, this.memberName, this.objectHandle, t.options.kind, weak)
    return t
  }

  static getControllerOf(method: F<any>): Controller<any> {
    const ctl = Meta.get<Controller<any> | undefined>(method, Meta.Controller)
    if (!ctl)
      throw misuse(`given method is not decorated as reactronic one: ${method.name}`)
    return ctl
  }

  static configureImpl(self: OperationController | undefined, options: Partial<MemberOptions>): MemberOptions {
    let op: Operation | undefined
    if (self)
      op = self.edit().operation
    else
      op = Operation.current
    if (!op)
      throw misuse('reactronic decorator is only applicable to methods')
    op.options = new OptionsImpl(op.options.getter, op.options.setter, op.options, options, false)
    if (Log.isOn && Log.opt.write)
      Log.write('║', '  =', `${op.hint()}.options are changed`)
    return op.options
  }

  static runWithin<T>(op: Operation | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined
    const outer = Operation.current
    try {
      Operation.current = op
      result = func(...args)
    }
    catch (e) {
      if (op)
        op.error = e
      throw e
    }
    finally {
      Operation.current = outer
    }
    return result
  }

  static why(): string {
    return Operation.current?.why() ?? BOOT_CAUSE
  }

  static briefWhy(): string {
    return Operation.current?.briefWhy() ?? BOOT_CAUSE
  }

  /* istanbul ignore next */
  static dependencies(): string[] {
    const op = Operation.current
    return op ? op.dependencies() : ['Rx.dependencies should be called from inside of reactive method']
  }

  // Internal

  private peek(args: any[] | undefined): OperationContext {
    const ctx = Changeset.current()
    const os: ObjectSnapshot = ctx.lookupObjectSnapshot(this.objectHandle, this.memberName)
    const op: Operation = this.acquireFromSnapshot(os, args)
    const isValid = op.options.kind !== Kind.Transactional && op.cause !== BOOT_CAUSE &&
      (ctx === op.changeset || ctx.timestamp < op.obsoleteSince) &&
      (!op.options.triggeringArgs || args === undefined ||
        op.args.length === args.length && op.args.every((t, i) => t === args[i])) || os.disposed
    return { operation: op, isUpToDate: isValid, changeset: ctx, snapshot: os }
  }

  private use(): OperationContext {
    const oc = this.peek(undefined)
    Changeset.markUsed(oc.operation, oc.snapshot,
      this.memberName, this.objectHandle, oc.operation.options.kind, true)
    return oc
  }

  private edit(): OperationContext {
    const h = this.objectHandle
    const m = this.memberName
    const ctx = Changeset.edit()
    const os: ObjectSnapshot = ctx.getEditableObjectSnapshot(h, m, Meta.Handle, this)
    let op: Operation = this.acquireFromSnapshot(os, undefined)
    if (op.changeset !== os.changeset) {
      const op2 = new Operation(this, os.changeset, op)
      os.data[m] = op2.reenterOver(op)
      ctx.bumpBy(os.former.snapshot.changeset.timestamp)
      Changeset.markEdited(op, op2, true, os, m, h)
      op = op2
    }
    return { operation: op, isUpToDate: true, changeset: ctx, snapshot: os }
  }

  private acquireFromSnapshot(os: ObjectSnapshot, args: any[] | undefined): Operation {
    const m = this.memberName
    let op: Operation = os.data[m]
    if (op.controller !== this) {
      if (os.changeset !== EMPTY_SNAPSHOT.changeset) {
        const hint: string = Log.isOn ? `${Dump.obj(this.objectHandle, m)}/init` : /* istanbul ignore next */ 'MethodController/init'
        const separation = os.changeset.sealed || os.former.snapshot !== EMPTY_SNAPSHOT
        op = Transaction.run<Operation>({ hint, separation, token: this }, (): Operation => {
          const h = this.objectHandle
          let r2: ObjectSnapshot = Changeset.current().getObjectSnapshot(h, m)
          let op2 = r2.data[m] as Operation
          if (op2.controller !== this) {
            r2 = Changeset.edit().getEditableObjectSnapshot(h, m, Meta.Handle, this)
            const t = new Operation(this, r2.changeset, op2)
            if (args)
              t.args = args
            t.cause = BOOT_CAUSE
            r2.data[m] = t
            Changeset.markEdited(op2, t, true, r2, m, h)
            op2 = t
          }
          return op2
        })
      }
      else {
        const t = new Operation(this, os.changeset, op)
        if (args)
          t.args = args
        t.cause = BOOT_CAUSE
        os.data[m] = t
        op = t
        if (Log.isOn && Log.opt.write)
          Log.write('║', ' ++', `${Dump.obj(this.objectHandle, m)} is initialized (revision ${os.revision})`)
      }
    }
    return op
  }

  private run(existing: OperationContext, separation: SeparationMode, options: MemberOptions, token: any, args: any[] | undefined): OperationContext {
    // TODO: Cleaner implementation is needed
    const hint: string = Log.isOn ? `${Dump.obj(this.objectHandle, this.memberName)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? ` - ${args[0]}` : ''}` : /* istanbul ignore next */ `${Dump.obj(this.objectHandle, this.memberName)}`
    let oc = existing
    const opts = { hint, separation, journal: options.journal, logging: options.logging, token }
    const result = Transaction.run(opts, (argsx: any[] | undefined): any => {
      if (!oc.operation.transaction.isCanceled) { // first run
        oc = this.edit()
        if (Log.isOn && Log.opt.operation)
          Log.write('║', '  o', `${oc.operation.why()}`)
        oc.operation.run(this.objectHandle.proxy, argsx)
      }
      else { // retry run
        oc = this.peek(argsx) // re-read on retry
        if (oc.operation.options.kind === Kind.Transactional || !oc.isUpToDate) {
          oc = this.edit()
          if (Log.isOn && Log.opt.operation)
            Log.write('║', '  o', `${oc.operation.why()}`)
          oc.operation.run(this.objectHandle.proxy, argsx)
        }
      }
      return oc.operation.result
    }, args)
    oc.operation.result = result
    return oc
  }

  private static markObsolete(self: OperationController): void {
    const oc = self.peek(undefined)
    const ctx = oc.changeset
    oc.operation.markObsoleteDueTo(oc.operation, self.memberName, EMPTY_SNAPSHOT.changeset, EMPTY_HANDLE, BOOT_CAUSE, ctx.timestamp, ctx.reactive)
  }
}

// Operation

class Operation extends Observable implements Observer {
  static current?: Operation = undefined
  static queuedReactiveFunctions: Array<Observer> = []
  static deferredReactiveFunctions: Array<Operation> = []

  readonly margin: number
  readonly transaction: Transaction
  readonly controller: OperationController
  readonly changeset: AbstractChangeset
  observables: Map<Observable, Subscription> | undefined
  options: OptionsImpl
  cause: string | undefined
  args: any[]
  result: any
  error: any
  started: number
  obsoleteDueTo: string | undefined
  obsoleteSince: number
  successor: Operation | undefined

  constructor(controller: OperationController, changeset: AbstractChangeset, former: Operation | OptionsImpl) {
    super(undefined)
    this.margin = Operation.current ? Operation.current.margin + 1 : 1
    this.transaction = Transaction.current
    this.controller = controller
    this.changeset = changeset
    this.observables = new Map<Observable, Subscription>()
    if (former instanceof Operation) {
      this.options = former.options
      this.args = former.args
      // this.value = former.value
      this.cause = former.obsoleteDueTo
    }
    else { // former: OptionsImpl
      this.options = former
      this.args = BOOT_ARGS
      this.cause = undefined
      // this.value = undefined
    }
    // this.result = undefined
    // this.error = undefined
    this.started = 0
    this.obsoleteSince = 0
    this.obsoleteDueTo = undefined
    this.successor = undefined
  }

  get isOperation(): boolean { return true } // override
  get originSnapshotId(): number { return this.changeset.id } // override
  hint(): string { return `${Dump.snapshot2(this.controller.objectHandle, this.changeset, this.controller.memberName)}` } // override
  get order(): number { return this.options.order }

  get ['#this#'](): string {
    return `Operation: ${this.why()}`
  }

  why(): string {
    let cause: string
    if (this.cause)
      cause = `   ◀◀   ${this.cause}`
    else if (this.controller.options.kind === Kind.Transactional)
      cause = '   ◀◀   operation'
    else
      cause = `   ◀◀   T${this.changeset.id}[${this.changeset.hint}]`
    return `${this.hint()}${cause}`
  }

  briefWhy(): string {
    return this.why()
  }

  dependencies(): string[] {
    throw misuse('not implemented yet')
  }

  wrap<T>(func: F<T>): F<T> {
    const wrappedForOperation: F<T> = (...args: any[]): T => {
      if (Log.isOn && Log.opt.step && this.result)
        Log.writeAs({margin2: this.margin}, '║', '‾\\', `${this.hint()} - step in  `, 0, '        │')
      const started = Date.now()
      const result = OperationController.runWithin<T>(this, func, ...args)
      const ms = Date.now() - started
      if (Log.isOn && Log.opt.step && this.result)
        Log.writeAs({margin2: this.margin}, '║', '_/', `${this.hint()} - step out `, 0, this.started > 0 ? '        │' : '')
      if (ms > Mvcc.mainThreadBlockingWarningThreshold) /* istanbul ignore next */
        Log.write('', '[!]', this.why(), ms, '    *** main thread is too busy ***')
      return result
    }
    return wrappedForOperation
  }

  run(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.obsoleteSince = MAX_REVISION
    if (!this.error)
      OperationController.runWithin<void>(this, Operation.run, this, proxy)
    else
      this.result = Promise.reject(this.error)
  }

  markObsoleteDueTo(observable: Observable, m: MemberName, changeset: AbstractChangeset, h: ObjectHandle, outer: string, since: number, reactive: Observer[]): void {
    if (this.observables !== undefined) { // if not yet marked as obsolete
      const skip = !observable.isOperation &&
        changeset === this.changeset /* &&
        snapshot.changes.has(memberName) */
      if (!skip) {
        const why = `${Dump.snapshot2(h, changeset, m, observable)}    ◀◀    ${outer}`
        const isReactive = this.options.kind === Kind.Reactive /*&& this.snapshot.data[Meta.Disposed] === undefined*/

        // Mark obsolete and unsubscribe from all (this.observables = undefined)
        this.obsoleteDueTo = why
        this.obsoleteSince = since
        if (Log.isOn && (Log.opt.obsolete || this.options.logging?.obsolete))
          Log.write(Log.opt.transaction && !Changeset.current().sealed ? '║' : ' ', isReactive ? '█' : '▒',
            isReactive && changeset === EMPTY_SNAPSHOT.changeset
              ? `${this.hint()} is reactive and will run automatically (order ${this.options.order})`
              : `${this.hint()} is obsolete due to ${Dump.snapshot2(h, changeset, m)} since s${since}${isReactive ? ` and will run automatically (order ${this.options.order})` : ''}`)
        this.unsubscribeFromAllObservables()

        // Stop cascade propagation on reactive function, or continue otherwise
        if (isReactive)
          reactive.push(this)
        else
          this.observers?.forEach(s => s.markObsoleteDueTo(this, this.controller.memberName, this.changeset, this.controller.objectHandle, why, since, reactive))

        // Cancel own transaction if it is still in progress
        const tran = this.transaction
        if (tran.changeset === changeset) {
          // do not cancel itself
        }
        else if (!tran.isFinished && this !== observable) // restart after itself if canceled
          tran.cancel(new Error(`T${tran.id}[${tran.hint}] is canceled due to obsolete ${Dump.snapshot2(h, changeset, m)} changed by T${changeset.id}[${changeset.hint}]`), null)
      }
      else if (Log.isOn && (Log.opt.obsolete || this.options.logging?.obsolete))
        Log.write(' ', 'x', `${this.hint()} is not obsolete due to its own change to ${Dump.snapshot2(h, changeset, m)}`)
    }
  }

  runIfNotUpToDate(now: boolean, nothrow: boolean): void {
    const t = this.options.throttling
    const interval = Date.now() + this.started // "started" is stored as negative value after reactive function completion
    const hold = t ? t - interval : 0 // "started" is stored as negative value after reactive function completion
    if (now || hold < 0) {
      if (this.isNotUpToDate()) {
        try {
          const op: Operation = this.controller.useOrRun(false, undefined)
          if (op.result instanceof Promise)
            op.result.catch(error => {
              if (op.options.kind === Kind.Reactive)
                misuse(`reactive function ${op.hint()} failed and will not run anymore: ${error}`, error)
            })
        }
        catch (e) {
          if (!nothrow)
            throw e
          else if (this.options.kind === Kind.Reactive)
            misuse(`reactive ${this.hint()} failed and will not run anymore: ${e}`, e)
        }
      }
    }
    else if (t < Number.MAX_SAFE_INTEGER) {
      if (hold > 0)
        setTimeout(() => this.runIfNotUpToDate(true, true), hold)
      else
        this.addToDeferredReactiveFunctions()
    }
  }

  isNotUpToDate(): boolean {
    return !this.error && (this.options.kind === Kind.Transactional ||
      !this.successor || this.successor.transaction.isCanceled)
  }

  reenterOver(head: Operation): this {
    let error: Error | undefined = undefined
    const opponent = head.successor
    if (opponent && !opponent.transaction.isFinished) {
      if (Log.isOn && Log.opt.obsolete)
        Log.write('║', ' [!]', `${this.hint()} is trying to re-enter over ${opponent.hint()}`)
      switch (head.options.reentrance) {
        case Reentrance.PreventWithError:
          if (!opponent.transaction.isCanceled)
            throw misuse(`${head.hint()} (${head.why()}) is not reentrant over ${opponent.hint()} (${opponent.why()})`)
          error = new Error(`T${this.transaction.id}[${this.transaction.hint}] is on hold/PreventWithError due to canceled T${opponent.transaction.id}[${opponent.transaction.hint}]`)
          this.transaction.cancel(error, opponent.transaction)
          break
        case Reentrance.WaitAndRestart:
          error = new Error(`T${this.transaction.id}[${this.transaction.hint}] is on hold/WaitAndRestart due to active T${opponent.transaction.id}[${opponent.transaction.hint}]`)
          this.transaction.cancel(error, opponent.transaction)
          break
        case Reentrance.CancelAndWaitPrevious:
          error = new Error(`T${this.transaction.id}[${this.transaction.hint}] is on hold/CancelAndWaitPrevious due to active T${opponent.transaction.id}[${opponent.transaction.hint}]`)
          this.transaction.cancel(error, opponent.transaction)
          opponent.transaction.cancel(new Error(`T${opponent.transaction.id}[${opponent.transaction.hint}] is canceled due to re-entering T${this.transaction.id}[${this.transaction.hint}]`), null)
          break
        case Reentrance.CancelPrevious:
          opponent.transaction.cancel(new Error(`T${opponent.transaction.id}[${opponent.transaction.hint}] is canceled due to re-entering T${this.transaction.id}[${this.transaction.hint}]`), null)
          break
        case Reentrance.RunSideBySide:
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

  private static run(op: Operation, proxy: any): void {
    op.enter()
    try {
      op.result = op.options.getter.call(proxy, ...op.args)
    }
    finally {
      op.leaveOrAsync()
    }
  }

  private enter(): void {
    if (this.options.monitor)
      this.monitorEnter(this.options.monitor)
    if (Log.isOn && Log.opt.operation)
      Log.write('║', '‾\\', `${this.hint()} - enter`, undefined, `    [ ${Dump.obj(this.controller.objectHandle, this.controller.memberName)} ]`)
    this.started = Date.now()
  }

  private leaveOrAsync(): void {
    if (this.result instanceof Promise) {
      this.result = this.result.then(
        value => {
          this.content = value
          this.leave(false, '  ⚐', '- finished  ', ' OK ──┘')
          return value
        },
        error => {
          this.error = error
          this.leave(false, '  ⚐', '- finished  ', 'ERR ──┘')
          throw error
        })
      if (Log.isOn) {
        if (Log.opt.operation)
          Log.write('║', '_/', `${this.hint()} - leave... `, 0, 'ASYNC ──┐')
        else if (Log.opt.transaction)
          Log.write('║', '  ', `${this.why()} ...`, 0, 'ASYNC')
      }
    }
    else {
      this.content = this.result
      this.leave(true, '_/', '- leave')
    }
  }

  private leave(main: boolean, op: string, message: string, highlight: string | undefined = undefined): void {
    const ms: number = Date.now() - this.started
    this.started = -this.started
    if (Log.isOn && Log.opt.operation)
      Log.write('║', `${op}`, `${this.hint()} ${message}`, ms, highlight)
    if (ms > (main ? Mvcc.mainThreadBlockingWarningThreshold : Mvcc.asyncActionDurationWarningThreshold)) /* istanbul ignore next */
      Log.write('', '[!]', this.why(), ms, main ? '    *** main thread is too busy ***' : '    *** async is too long ***')
    this.cause = undefined
    if (this.options.monitor)
      this.monitorLeave(this.options.monitor)
    // CachedResult.freeze(this)
  }

  private monitorEnter(mon: Monitor): void {
    const options: SnapshotOptions = {
      hint: 'Monitor.enter',
      separation: 'isolated',
      logging: Log.isOn && Log.opt.monitor ? undefined : Log.global }
    OperationController.runWithin<void>(undefined, Transaction.run, options,
      MonitorImpl.enter, mon, this.transaction)
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.outside<void>(() => {
      const leave = (): void => {
        const options: SnapshotOptions = {
          hint: 'Monitor.leave',
          separation: 'isolated',
          logging: Log.isOn && Log.opt.monitor ? undefined : Log.DefaultLevel }
        OperationController.runWithin<void>(undefined, Transaction.run, options,
          MonitorImpl.leave, mon, this.transaction)
      }
      this.transaction.whenFinished().then(leave, leave)
    })
  }

  private addToDeferredReactiveFunctions(): void {
    Operation.deferredReactiveFunctions.push(this)
    if (Operation.deferredReactiveFunctions.length === 1)
      setTimeout(Operation.processDeferredReactiveFunctions, 0)
  }

  private static processDeferredReactiveFunctions(): void {
    const deferred = Operation.deferredReactiveFunctions
    Operation.deferredReactiveFunctions = [] // reset
    for (const x of deferred)
      x.runIfNotUpToDate(true, true)
  }

  private static markUsed(observable: Observable, os: ObjectSnapshot, m: MemberName, h: ObjectHandle, kind: Kind, weak: boolean): void {
    if (kind !== Kind.Transactional) {
      const op: Operation | undefined = Operation.current // alias
      if (op && op.options.kind !== Kind.Transactional &&
        op.transaction === Transaction.current && m !== Meta.Handle) {
        const ctx = Changeset.current()
        if (ctx !== os.changeset) // snapshot should not bump itself
          ctx.bumpBy(os.changeset.timestamp)
        const t = weak ? -1 : ctx.timestamp
        if (!op.subscribeTo(observable, os, m, h, t))
          op.markObsoleteDueTo(observable, m, h.head.changeset, h, BOOT_CAUSE, ctx.timestamp, ctx.reactive)
      }
    }
  }

  private static markEdited(oldValue: any, newValue: any, edited: boolean, os: ObjectSnapshot, m: MemberName, h: ObjectHandle): void {
    edited ? os.changes.add(m) : os.changes.delete(m)
    if (Log.isOn && Log.opt.write)
      edited ? Log.write('║', '  =', `${Dump.snapshot2(h, os.changeset, m)} is changed: ${valueHint(oldValue)} ▸▸ ${valueHint(newValue)}`) : Log.write('║', '  =', `${Dump.snapshot2(h, os.changeset, m)} is changed: ${valueHint(oldValue)} ▸▸ ${valueHint(newValue)}`, undefined, ' (same as previous)')
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof Operation && oldValue.cause !== BOOT_CAUSE
    return result
  }

  private static propagateAllChangesThroughSubscriptions(changeset: Changeset): void {
    const since = changeset.timestamp
    const reactive = changeset.reactive
    changeset.items.forEach((os: ObjectSnapshot, h: ObjectHandle) => {
      Operation.propagateMemberChangeThroughSubscriptions(false, since, os, Meta.Revision, h, reactive)
      if (!os.disposed)
        os.changes.forEach((o, m) => Operation.propagateMemberChangeThroughSubscriptions(false, since, os, m, h, reactive))
      else
        for (const m in os.former.snapshot.data)
          Operation.propagateMemberChangeThroughSubscriptions(true, since, os, m, h, reactive)
    })
    reactive.sort(compareReactiveFunctionsByOrder)
    changeset.options.journal?.edited(
      JournalImpl.buildPatch(changeset.hint, changeset.items))
  }

  private static revokeAllSubscriptions(changeset: Changeset): void {
    changeset.items.forEach((os: ObjectSnapshot, h: ObjectHandle) => {
      Operation.propagateMemberChangeThroughSubscriptions(
        true, changeset.timestamp, os, Meta.Revision, h, undefined)
      os.changes.forEach((o, m) => Operation.propagateMemberChangeThroughSubscriptions(
        true, changeset.timestamp, os, m, h, undefined))
    })
  }

  private static propagateMemberChangeThroughSubscriptions(unsubscribe: boolean, timestamp: number,
    os: ObjectSnapshot, m: MemberName, h: ObjectHandle, reactive?: Observer[]): void {
    const curr = os.data[m]
    if (reactive) {
      // Propagate change to reactive functions
      const former = os.former.snapshot.data[m]
      if (former !== undefined && former instanceof Observable) {
        const why = `T${os.changeset.id}[${os.changeset.hint}]`
        if (former instanceof Operation) {
          if ((former.obsoleteSince === MAX_REVISION || former.obsoleteSince <= 0)) {
            former.obsoleteDueTo = why
            former.obsoleteSince = timestamp
            former.unsubscribeFromAllObservables()
          }
          const formerSuccessor = former.successor
          if (formerSuccessor !== curr) {
            if (formerSuccessor && !formerSuccessor.transaction.isFinished)
              formerSuccessor.transaction.cancel(new Error(`T${formerSuccessor.transaction.id}[${formerSuccessor.transaction.hint}] is canceled by T${os.changeset.id}[${os.changeset.hint}] and will not run anymore`), null)
          }
          else
            former.successor = undefined
        }
        former.observers?.forEach(s =>
          s.markObsoleteDueTo(former, m, os.changeset, h, why, timestamp, reactive))
      }
    }
    if (curr instanceof Operation) {
      if (curr.changeset === os.changeset && curr.observables !== undefined) {
        if (Mvcc.repetitiveUsageWarningThreshold < Number.MAX_SAFE_INTEGER) {
          curr.observables.forEach((info, v) => { // performance tracking info
            if (info.usageCount > Mvcc.repetitiveUsageWarningThreshold)
              Log.write('', '[!]', `${curr.hint()} uses ${info.memberHint} ${info.usageCount} times (consider remembering it in a local variable)`, 0, ' *** WARNING ***')
          })
        }
        if (unsubscribe)
          curr.unsubscribeFromAllObservables()
      }
    }
    else if (curr instanceof Observable && curr.observers) {
      // // Unsubscribe from own-changed subscriptions
      // curr.observers.forEach(o => {
      //   // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      //   o.observables!.delete(curr)
      //   if (Log.isOn && Log.opt.read)
      //     Log.write(Log.opt.transaction && !Changeset.current().sealed ? '║' : ' ', '-', `${o.hint()} is unsubscribed from own-changed ${Dump.snap(r, m)}`)
      // })
      // curr.observers = undefined
    }
  }

  private static enqueueReactiveFunctionsToRun(reactive: Array<Observer>): void {
    const queue = Operation.queuedReactiveFunctions
    const isReactiveLoopRequired = queue.length === 0
    for (const r of reactive)
      queue.push(r)
    if (isReactiveLoopRequired)
      OperationController.runWithin<void>(undefined, Operation.runQueuedReactiveLoop)
  }

  private static runQueuedReactiveLoop(): void {
    const queue = Operation.queuedReactiveFunctions
    let i = 0
    while (i < queue.length) {
      const reactive = queue[i]
      reactive.runIfNotUpToDate(false, true)
      i++
    }
    Operation.queuedReactiveFunctions = [] // reset loop
  }

  private unsubscribeFromAllObservables(): void {
    // It's critical to have no exceptions here
    this.observables?.forEach((info, value) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value.observers!.delete(this)
      if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write(Log.opt.transaction && !Changeset.current().sealed ? '║' : ' ', '-', `${this.hint()} is unsubscribed from ${info.memberHint}`)
    })
    this.observables = undefined
  }

  private subscribeTo(observable: Observable, os: ObjectSnapshot, m: MemberName, h: ObjectHandle, timestamp: number): boolean {
    const ok = Operation.canSubscribe(observable, os, m, h, timestamp)
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
          observable.observers = new Set<Operation>()
        // Two-way linking
        const subscription: Subscription = { memberHint: Dump.snapshot2(h, os.changeset, m), usageCount: times }
        observable.observers.add(this)
        this.observables!.set(observable, subscription)
        if (Log.isOn && (Log.opt.read || this.options.logging?.read))
          Log.write('║', '  ∞', `${this.hint()} is subscribed to ${Dump.snapshot2(h, os.changeset, m)}${subscription.usageCount > 1 ? ` (${subscription.usageCount} times)` : ''}`)
      }
      else if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write('║', '  x', `${this.hint()} is obsolete and is NOT subscribed to ${Dump.snapshot2(h, os.changeset, m)}`)
    }
    else {
      if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write('║', '  x', `${this.hint()} is NOT subscribed to already obsolete ${Dump.snapshot2(h, os.changeset, m)}`)
    }
    return ok // || subscription.next === r
  }

  private static canSubscribe(observable: Observable, os: ObjectSnapshot, m: MemberName, h: ObjectHandle, timestamp: number): boolean {
    let result = observable === h.head.data[m] || os.former.snapshot == h.head
    if (result && timestamp !== -1)
      result = !(observable instanceof Operation && timestamp >= observable.obsoleteSince)
    return result
  }

  private static createOperation(h: ObjectHandle, m: MemberName, options: OptionsImpl): F<any> {
    const ctl = new OperationController(h, m)
    const operation: F<any> = (...args: any[]): any => {
      return ctl.useOrRun(false, args).result
    }
    Meta.set(operation, Meta.Controller, ctl)
    return operation
  }

  private static rememberOperationOptions(proto: any, m: MemberName, getter: Function | undefined, setter: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<MemberOptions>, implicit: boolean): OptionsImpl {
    // Configure options
    const initial: any = Meta.acquire(proto, Meta.Initial)
    let op: Operation | undefined = initial[m]
    const ctl = op ? op.controller : new OperationController(EMPTY_HANDLE, m)
    const opts = op ? op.options : OptionsImpl.INITIAL
    initial[m] = op = new Operation(ctl, EMPTY_SNAPSHOT.changeset, new OptionsImpl(getter, setter, opts, options, implicit))
    // Add to the list if it's a reactive function
    if (op.options.kind === Kind.Reactive && op.options.throttling < Number.MAX_SAFE_INTEGER) {
      const reactive = Meta.acquire(proto, Meta.Reactive)
      reactive[m] = op
    }
    else if (op.options.kind === Kind.Reactive && op.options.throttling >= Number.MAX_SAFE_INTEGER) {
      const reactive = Meta.getFrom(proto, Meta.Reactive)
      delete reactive[m]
    }
    return op.options
  }

  // static freeze(c: CachedResult): void {
  //   Utils.freezeMap(c.observables)
  //   Object.freeze(c)
  // }

  static init(): void {
    Object.freeze(BOOT_ARGS)
    Log.getMergedLoggingOptions = getMergedLoggingOptions
    Dump.valueHint = valueHint
    Changeset.markUsed = Operation.markUsed // override
    Changeset.markEdited = Operation.markEdited // override
    Changeset.isConflicting = Operation.isConflicting // override
    Changeset.propagateAllChangesThroughSubscriptions = Operation.propagateAllChangesThroughSubscriptions // override
    Changeset.revokeAllSubscriptions = Operation.revokeAllSubscriptions // override
    Changeset.enqueueReactiveFunctionsToRun = Operation.enqueueReactiveFunctionsToRun
    Mvcc.createOperation = Operation.createOperation // override
    Mvcc.rememberOperationOptions = Operation.rememberOperationOptions // override
    Promise.prototype.then = reactronicHookedThen // override
    try {
      Object.defineProperty(globalThis, 'rWhy', {
        get: OperationController.why, configurable: false, enumerable: false,
      })
      Object.defineProperty(globalThis, 'rBriefWhy', {
        get: OperationController.briefWhy, configurable: false, enumerable: false,
      })
    }
    catch (e) {
      // ignore
    }
    try {
      Object.defineProperty(global, 'rWhy', {
        get: OperationController.why, configurable: false, enumerable: false,
      })
      Object.defineProperty(global, 'rBriefWhy', {
        get: OperationController.briefWhy, configurable: false, enumerable: false,
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
  let result: string = ''
  if (Array.isArray(value))
    result = `Array(${value.length})`
  else if (value instanceof Set)
    result = `Set(${value.size})`
  else if (value instanceof Map)
    result = `Map(${value.size})`
  else if (value instanceof Operation)
    result = `#${value.controller.objectHandle.id}t${value.changeset.id}s${value.changeset.timestamp}${value.originSnapshotId !== undefined && value.originSnapshotId !== 0 ? `t${value.originSnapshotId}` : ''}`
  else if (value === Meta.Undefined)
    result = 'undefined'
  else if (typeof(value) === 'string')
    result = `"${value.toString().slice(0, 20)}${value.length > 20 ? '...' : ''}"`
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 40)
  else
    result = 'undefined'
  return result
}

function getMergedLoggingOptions(local: Partial<LoggingOptions> | undefined): LoggingOptions {
  const t = Transaction.current
  let res = Log.merge(t.options.logging, t.id > 1 ? 31 + t.id % 6 : 37, t.id > 1 ? `T${t.id}` : `-${Changeset.idGen.toString().replace(/[0-9]/g, '-')}`, Log.global)
  res = Log.merge({margin1: t.margin}, undefined, undefined, res)
  if (Operation.current)
    res = Log.merge({margin2: Operation.current.margin}, undefined, undefined, res)
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
    const op = Operation.current
    if (op) {
      resolve = op.wrap(resolve)
      reject = op.wrap(reject)
    }
    resolve = tran.wrap(resolve, false)
    reject = tran.wrap(reject, true)
  }
  return ORIGINAL_PROMISE_THEN.call(this, resolve, reject)
}

function compareReactiveFunctionsByOrder(a: Observer, b: Observer): number {
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

Operation.init()
