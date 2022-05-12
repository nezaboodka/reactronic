// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from '../util/Utils'
import { Log, misuse } from '../util/Dbg'
import { MemberOptions, Kind, Reentrance, LoggingOptions, SnapshotOptions } from '../Options'
import { Controller } from '../Controller'
import { DataRevision, MemberName, DataHolder, Subscription, Subscriber, StandaloneMode, SubscriptionInfo, Meta, AbstractSnapshot } from './Data'
import { Snapshot, Dump, ROOT_REV, MAX_TIMESTAMP } from './Snapshot'
import { Transaction } from './Transaction'
import { Monitor, MonitorImpl } from './Monitor'
import { Hooks, OptionsImpl } from './Hooks'
import { JournalImpl } from './Journal'

const BOOT_ARGS: any[] = []
const BOOT_CAUSE = '<boot>'
const ROOT_HOLDER = new DataHolder(undefined, undefined, Hooks.handler, ROOT_REV, '<root>')

type OperationContext = {
  readonly operation: Operation
  readonly isUpToDate: boolean
  readonly snapshot: Snapshot
  readonly revision: DataRevision
}

export class OperationController extends Controller<any> {
  readonly ownHolder: DataHolder
  readonly memberName: MemberName

  configure(options: Partial<MemberOptions>): MemberOptions { return OperationController.configureImpl(this, options) }
  get options(): MemberOptions { return this.peek(undefined).operation.options }
  get nonreactive(): any { return this.peek(undefined).operation.content }
  get args(): ReadonlyArray<any> { return this.use().operation.args }
  get result(): any { return this.useOrRun(true, undefined).content }
  get error(): boolean { return this.use().operation.error }
  get stamp(): number { return this.use().revision.snapshot.timestamp }
  get isUpToDate(): boolean { return this.use().isUpToDate }
  markObsolete(): void { Transaction.run({ hint: Log.isOn ? `markObsolete(${Dump.obj(this.ownHolder, this.memberName)})` : 'markObsolete()' }, OperationController.markObsolete, this) }
  pullLastResult(args?: any[]): any { return this.useOrRun(true, args).content }

  constructor(ownHolder: DataHolder, memberName: MemberName) {
    super()
    this.ownHolder = ownHolder
    this.memberName = memberName
  }

  useOrRun(weak: boolean, args: any[] | undefined): Operation {
    let oc: OperationContext = this.peek(args)
    const ctx = oc.snapshot
    const op: Operation = oc.operation
    const opts = op.options
    if (!oc.isUpToDate && oc.revision.data[Meta.Disposed] === undefined
      && (!weak || op.cause === BOOT_CAUSE || !op.successor ||
        op.successor.transaction.isFinished)) {
      const outerOpts = Operation.current?.options
      const standalone = weak || opts.standalone || opts.kind === Kind.Reaction ||
        (opts.kind === Kind.Transaction && outerOpts && (outerOpts.noSideEffects || outerOpts.kind === Kind.Cache)) ||
        (opts.kind === Kind.Cache && (oc.revision.snapshot.sealed ||
          oc.revision.former.revision !== ROOT_REV))
      const token = opts.noSideEffects ? this : undefined
      const oc2 = this.run(oc, standalone, opts, token, args)
      const ctx2 = oc2.operation.snapshot
      if (!weak || ctx === ctx2 || (ctx2.sealed && ctx.timestamp >= ctx2.timestamp))
        oc = oc2
    }
    else if (Log.isOn && Log.opt.operation && (opts.logging === undefined ||
      opts.logging.operation === undefined || opts.logging.operation === true))
      Log.write(Transaction.current.isFinished ? '' : '║', ' (=)',
        `${Dump.rev2(oc.operation.controller.ownHolder, oc.snapshot, this.memberName)} result is reused from T${oc.operation.transaction.id}[${oc.operation.transaction.hint}]`)
    const t = oc.operation
    Snapshot.markUsed(t, oc.revision, this.memberName, this.ownHolder, t.options.kind, weak)
    return t
  }

  static of(method: F<any>): Controller<any> {
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
      Log.write('║', '  ✎', `${op.hint()}.options are changed`)
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
    const ctx = Snapshot.current()
    const r: DataRevision = ctx.seekRevision(this.ownHolder, this.memberName)
    const op: Operation = this.acquireFromRevision(r, args)
    const isValid = op.options.kind !== Kind.Transaction && op.cause !== BOOT_CAUSE &&
      (ctx === op.snapshot || ctx.timestamp < op.obsoleteSince) &&
      (!op.options.triggeringArgs || args === undefined ||
        op.args.length === args.length && op.args.every((t, i) => t === args[i])) ||
      r.data[Meta.Disposed] !== undefined
    return { operation: op, isUpToDate: isValid, snapshot: ctx, revision: r }
  }

  private use(): OperationContext {
    const oc = this.peek(undefined)
    Snapshot.markUsed(oc.operation, oc.revision,
      this.memberName, this.ownHolder, oc.operation.options.kind, true)
    return oc
  }

  private edit(): OperationContext {
    const h = this.ownHolder
    const m = this.memberName
    const ctx = Snapshot.edit()
    const r: DataRevision = ctx.getEditableRevision(h, m, Meta.Holder, this)
    let op: Operation = this.acquireFromRevision(r, undefined)
    if (op.snapshot !== r.snapshot) {
      const op2 = new Operation(this, r.snapshot, op)
      r.data[m] = op2.reenterOver(op)
      ctx.bumpBy(r.former.revision.snapshot.timestamp)
      Snapshot.markEdited(op, op2, true, r, m, h)
      op = op2
    }
    return { operation: op, isUpToDate: true, snapshot: ctx, revision: r }
  }

  private acquireFromRevision(r: DataRevision, args: any[] | undefined): Operation {
    const m = this.memberName
    let op: Operation = r.data[m]
    if (op.controller !== this) {
      if (r.snapshot !== ROOT_REV.snapshot) {
        const hint: string = Log.isOn ? `${Dump.obj(this.ownHolder, m)}/boot` : /* istanbul ignore next */ 'MethodController/init'
        const standalone = r.snapshot.sealed || r.former.revision !== ROOT_REV
        op = Transaction.run<Operation>({ hint, standalone, token: this }, (): Operation => {
          const h = this.ownHolder
          let r2: DataRevision = Snapshot.current().getCurrentRevision(h, m)
          let op2 = r2.data[m] as Operation
          if (op2.controller !== this) {
            r2 = Snapshot.edit().getEditableRevision(h, m, Meta.Holder, this)
            const t = new Operation(this, r2.snapshot, op2)
            if (args)
              t.args = args
            t.cause = BOOT_CAUSE
            r2.data[m] = t
            Snapshot.markEdited(op2, t, true, r2, m, h)
            op2 = t
          }
          return op2
        })
      }
      else {
        const t = new Operation(this, r.snapshot, op)
        if (args)
          t.args = args
        t.cause = BOOT_CAUSE
        r.data[m] = t
        op = t
        if (Log.isOn && Log.opt.write)
          Log.write('║', '  ⎘', `${Dump.obj(this.ownHolder, m)} is cloned outside of transaction`)
      }
    }
    return op
  }

  private run(existing: OperationContext, standalone: StandaloneMode, options: MemberOptions, token: any, args: any[] | undefined): OperationContext {
    // TODO: Cleaner implementation is needed
    const hint: string = Log.isOn ? `${Dump.obj(this.ownHolder, this.memberName)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? ` - ${args[0]}` : ''}` : /* istanbul ignore next */ `${Dump.obj(this.ownHolder, this.memberName)}`
    let oc = existing
    const opts = { hint, standalone, journal: options.journal, logging: options.logging, token }
    const result = Transaction.run(opts, (argsx: any[] | undefined): any => {
      if (!oc.operation.transaction.isCanceled) { // first run
        oc = this.edit()
        if (Log.isOn && Log.opt.operation)
          Log.write('║', '  𝑓', `${oc.operation.why()}`)
        oc.operation.run(this.ownHolder.proxy, argsx)
      }
      else { // retry run
        oc = this.peek(argsx) // re-read on retry
        if (oc.operation.options.kind === Kind.Transaction || !oc.isUpToDate) {
          oc = this.edit()
          if (Log.isOn && Log.opt.operation)
            Log.write('║', '  𝑓', `${oc.operation.why()}`)
          oc.operation.run(this.ownHolder.proxy, argsx)
        }
      }
      return oc.operation.result
    }, args)
    oc.operation.result = result
    return oc
  }

  private static markObsolete(self: OperationController): void {
    const oc = self.peek(undefined)
    const ctx = oc.snapshot
    oc.operation.markObsoleteDueTo(oc.operation, self.memberName, ROOT_REV.snapshot, ROOT_HOLDER, BOOT_CAUSE, ctx.timestamp, ctx.reactions)
  }
}

// Operation

class Operation extends Subscription implements Subscriber {
  static current?: Operation = undefined
  static queuedReactions: Array<Subscriber> = []
  static deferredReactions: Array<Operation> = []

  readonly margin: number
  readonly transaction: Transaction
  readonly controller: OperationController
  readonly snapshot: AbstractSnapshot
  subscriptions: Map<Subscription, SubscriptionInfo> | undefined
  options: OptionsImpl
  cause: string | undefined
  args: any[]
  result: any
  error: any
  started: number
  obsoleteDueTo: string | undefined
  obsoleteSince: number
  successor: Operation | undefined

  constructor(controller: OperationController, snapshot: AbstractSnapshot, former: Operation | OptionsImpl) {
    super(undefined)
    this.margin = Operation.current ? Operation.current.margin + 1 : 1
    this.transaction = Transaction.current
    this.controller = controller
    this.snapshot = snapshot
    this.subscriptions = new Map<Subscription, SubscriptionInfo>()
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
  get originSnapshotId(): number { return this.snapshot.id } // override
  hint(): string { return `${Dump.rev2(this.controller.ownHolder, this.snapshot, this.controller.memberName)}` } // override
  get order(): number { return this.options.order }

  get ['#this'](): string {
    return `Operation: ${this.why()}`
  }

  why(): string {
    let cause: string
    if (this.cause)
      cause = `   <<   ${this.cause}`
    else if (this.controller.options.kind === Kind.Transaction)
      cause = '   <<   operation'
    else
      cause = `   <<   T${this.snapshot.id}[${this.snapshot.hint}]`
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
      if (ms > Hooks.mainThreadBlockingWarningThreshold) /* istanbul ignore next */
        Log.write('', '[!]', this.why(), ms, '    *** main thread is too busy ***')
      return result
    }
    return wrappedForOperation
  }

  run(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.obsoleteSince = MAX_TIMESTAMP
    if (!this.error)
      OperationController.runWithin<void>(this, Operation.run, this, proxy)
    else
      this.result = Promise.reject(this.error)
  }

  markObsoleteDueTo(subscription: Subscription, memberName: MemberName, snapshot: AbstractSnapshot, holder: DataHolder, outer: string, since: number, reactions: Subscriber[]): void {
    if (this.subscriptions !== undefined) { // if not yet marked as obsolete
      const skip = !subscription.isOperation &&
        snapshot === this.snapshot /* &&
        revision.changes.has(memberName) */
      if (!skip) {
        const why = `${Dump.rev2(holder, snapshot, memberName, subscription)}    <<    ${outer}`
        // Mark obsolete (this.subscriptions = undefined)
        this.unsubscribeFromAllSubscriptions()
        this.obsoleteDueTo = why
        this.obsoleteSince = since

        const isReaction = this.options.kind === Kind.Reaction /*&& this.revision.data[Meta.Disposed] === undefined*/
        if (Log.isOn && (Log.opt.obsolete || this.options.logging?.obsolete))
          Log.write(Log.opt.transaction && !Snapshot.current().sealed ? '║' : ' ', isReaction ? '█' : '▒',
            isReaction && snapshot === ROOT_REV.snapshot
              ? `${this.hint()} is a reaction and will run automatically (order ${this.options.order})`
              : `${this.hint()} is obsolete due to ${Dump.rev2(holder, snapshot, memberName)} since v${since}${isReaction ? ` and will run automatically (order ${this.options.order})` : ''}`)

        // Stop cascade propagation on reaction, or continue otherwise
        if (isReaction)
          reactions.push(this)
        else
          this.subscribers?.forEach(s => s.markObsoleteDueTo(this, this.controller.memberName, this.snapshot, this.controller.ownHolder, why, since, reactions))

        // Cancel own transaction if it is still in progress
        const tran = this.transaction
        if (tran.snapshot === snapshot) {
          // do not cancel itself
        }
        else if (!tran.isFinished && this !== subscription) // restart after itself if canceled
          tran.cancel(new Error(`T${tran.id}[${tran.hint}] is canceled due to obsolete ${Dump.rev2(holder, snapshot, memberName)} changed by T${snapshot.id}[${snapshot.hint}]`), null)
      }
      else if (Log.isOn && (Log.opt.obsolete || this.options.logging?.obsolete))
        Log.write(' ', 'x', `${this.hint()} is not obsolete due to its own change to ${Dump.rev2(holder, snapshot, memberName)}`)
    }
  }

  runIfNotUpToDate(now: boolean, nothrow: boolean): void {
    const t = this.options.throttling
    const interval = Date.now() + this.started // "started" is stored as negative value after reaction completion
    const hold = t ? t - interval : 0 // "started" is stored as negative value after reaction completion
    if (now || hold < 0) {
      if (this.isNotUpToDate()) {
        try {
          const op: Operation = this.controller.useOrRun(false, undefined)
          if (op.result instanceof Promise)
            op.result.catch(error => {
              if (op.options.kind === Kind.Reaction)
                misuse(`reaction ${op.hint()} failed and will not run anymore: ${error}`, error)
            })
        }
        catch (e) {
          if (!nothrow)
            throw e
          else if (this.options.kind === Kind.Reaction)
            misuse(`reaction ${this.hint()} failed and will not run anymore: ${e}`, e)
        }
      }
    }
    else if (t < Number.MAX_SAFE_INTEGER) {
      if (hold > 0)
        setTimeout(() => this.runIfNotUpToDate(true, true), hold)
      else
        this.addToDeferredReactions()
    }
  }

  isNotUpToDate(): boolean {
    return !this.error && (this.options.kind === Kind.Transaction ||
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
      Log.write('║', '‾\\', `${this.hint()} - enter`, undefined, `    [ ${Dump.obj(this.controller.ownHolder, this.controller.memberName)} ]`)
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
    if (ms > (main ? Hooks.mainThreadBlockingWarningThreshold : Hooks.asyncActionDurationWarningThreshold)) /* istanbul ignore next */
      Log.write('', '[!]', this.why(), ms, main ? '    *** main thread is too busy ***' : '    *** async is too long ***')
    this.cause = undefined
    if (this.options.monitor)
      this.monitorLeave(this.options.monitor)
    // CachedResult.freeze(this)
  }

  private monitorEnter(mon: Monitor): void {
    const options: SnapshotOptions = {
      hint: 'Monitor.enter',
      standalone: 'isolated',
      logging: Log.isOn && Log.opt.monitor ? undefined : Log.global }
    OperationController.runWithin<void>(undefined, Transaction.run, options,
      MonitorImpl.enter, mon, this.transaction)
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.off<void>(() => {
      const leave = (): void => {
        const options: SnapshotOptions = {
          hint: 'Monitor.leave',
          standalone: 'isolated',
          logging: Log.isOn && Log.opt.monitor ? undefined : Log.DefaultLevel }
        OperationController.runWithin<void>(undefined, Transaction.run, options,
          MonitorImpl.leave, mon, this.transaction)
      }
      this.transaction.whenFinished().then(leave, leave)
    })
  }

  private addToDeferredReactions(): void {
    Operation.deferredReactions.push(this)
    if (Operation.deferredReactions.length === 1)
      setTimeout(Operation.processDeferredReactions, 0)
  }

  private static processDeferredReactions(): void {
    const reactions = Operation.deferredReactions
    Operation.deferredReactions = [] // reset
    for (const x of reactions)
      x.runIfNotUpToDate(true, true)
  }

  private static markUsed(subscription: Subscription, r: DataRevision, m: MemberName, h: DataHolder, kind: Kind, weak: boolean): void {
    if (kind !== Kind.Transaction) {
      const op: Operation | undefined = Operation.current // alias
      if (op && op.options.kind !== Kind.Transaction &&
        op.transaction === Transaction.current && m !== Meta.Holder) {
        const ctx = Snapshot.current()
        if (ctx !== r.snapshot) // snapshot should not bump itself
          ctx.bumpBy(r.snapshot.timestamp)
        const t = weak ? -1 : ctx.timestamp
        if (!op.subscribeTo(subscription, r, m, h, t))
          op.markObsoleteDueTo(subscription, m, r.snapshot, h, BOOT_CAUSE, ctx.timestamp, ctx.reactions)
      }
    }
  }

  private static markEdited(oldValue: any, newValue: any, edited: boolean, r: DataRevision, m: MemberName, h: DataHolder): void {
    edited ? r.changes.add(m) : r.changes.delete(m)
    if (Log.isOn && Log.opt.write)
      edited ? Log.write('║', '  ✎', `${Dump.rev2(h, r.snapshot, m)} is changed from ${valueHint(oldValue, m)} to ${valueHint(newValue, m)}`) : Log.write('║', '  ✎', `${Dump.rev2(h, r.snapshot, m)} is changed from ${valueHint(oldValue, m)} to ${valueHint(newValue, m)}`, undefined, ' (same as previous)')
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof Operation && oldValue.cause !== BOOT_CAUSE
    return result
  }

  private static propagateAllChangesThroughSubscriptions(snapshot: Snapshot): void {
    const since = snapshot.timestamp
    const reactions = snapshot.reactions
    snapshot.changeset.forEach((r: DataRevision, h: DataHolder) => {
      if (!r.changes.has(Meta.Disposed))
        r.changes.forEach((o, m) => Operation.propagateMemberChangeThroughSubscriptions(false, since, r, m, h, reactions))
      else
        for (const m in r.former.revision.data)
          Operation.propagateMemberChangeThroughSubscriptions(true, since, r, m, h, reactions)
    })
    reactions.sort(compareReactionsByOrder)
    snapshot.options.journal?.edited(
      JournalImpl.buildPatch(snapshot.hint, snapshot.changeset))
  }

  private static revokeAllSubscriptions(snapshot: Snapshot): void {
    snapshot.changeset.forEach((r: DataRevision, h: DataHolder) =>
      r.changes.forEach((o, m) => Operation.propagateMemberChangeThroughSubscriptions(
        true, snapshot.timestamp, r, m, h, undefined)))
  }

  private static propagateMemberChangeThroughSubscriptions(unsubscribe: boolean, timestamp: number,
    r: DataRevision, m: MemberName, h: DataHolder, reactions?: Subscriber[]): void {
    const curr = r.data[m]
    if (reactions) {
      // Propagate change to reactions
      const former = r.former.revision.data[m]
      if (former !== undefined && former instanceof Subscription) {
        const why = `T${r.snapshot.id}[${r.snapshot.hint}]`
        // const cause: MemberInfo = { holder: h, snapshot: r.snapshot, memberName: m, usageCount: 0 }
        if (former instanceof Operation) {
          if ((former.obsoleteSince === MAX_TIMESTAMP || former.obsoleteSince <= 0)) {
            former.obsoleteDueTo = why
            former.obsoleteSince = timestamp
            former.unsubscribeFromAllSubscriptions()
          }
          const formerSuccessor = former.successor
          if (formerSuccessor !== curr) {
            if (formerSuccessor && !formerSuccessor.transaction.isFinished)
              formerSuccessor.transaction.cancel(new Error(`T${formerSuccessor.transaction.id}[${formerSuccessor.transaction.hint}] is canceled by T${r.snapshot.id}[${r.snapshot.hint}] and will not run anymore`), null)
          }
          else
            former.successor = undefined
        }
        former.subscribers?.forEach(s =>
          s.markObsoleteDueTo(former, m, r.snapshot, h, why, timestamp, reactions))
      }
    }
    if (curr instanceof Operation) {
      if (curr.snapshot === r.snapshot && curr.subscriptions !== undefined) {
        if (Hooks.repetitiveUsageWarningThreshold < Number.MAX_SAFE_INTEGER) {
          curr.subscriptions.forEach((info, v) => { // performance tracking info
            if (info.usageCount > Hooks.repetitiveUsageWarningThreshold)
              Log.write('', '[!]', `${curr.hint()} uses ${info.memberHint} ${info.usageCount} times (consider remembering it in a local variable)`, 0, ' *** WARNING ***')
          })
        }
        if (unsubscribe)
          curr.unsubscribeFromAllSubscriptions()
      }
    }
    else if (curr instanceof Subscription && curr.subscribers) {
      // // Unsubscribe from own-changed subscriptions
      // curr.observers.forEach(o => {
      //   // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      //   o.subscriptions!.delete(curr)
      //   if (Log.isOn && Log.opt.read)
      //     Log.write(Log.opt.transaction && !Snapshot.current().sealed ? '║' : ' ', '-', `${o.hint()} is unsubscribed from own-changed ${Dump.rev(r, m)}`)
      // })
      // curr.observers = undefined
    }
  }

  private static enqueueReactionsToRun(reactions: Array<Subscriber>): void {
    const queue = Operation.queuedReactions
    const isReactionLoopRequired = queue.length === 0
    for (const r of reactions)
      queue.push(r)
    if (isReactionLoopRequired)
      OperationController.runWithin<void>(undefined, Operation.runQueuedReactionsLoop)
  }

  private static runQueuedReactionsLoop(): void {
    const queue = Operation.queuedReactions
    let i = 0
    while (i < queue.length) {
      const reaction = queue[i]
      reaction.runIfNotUpToDate(false, true)
      i++
    }
    Operation.queuedReactions = [] // reset loop
  }

  private unsubscribeFromAllSubscriptions(): void {
    // It's critical to have no exceptions here
    this.subscriptions?.forEach((info, value) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value.subscribers!.delete(this)
      if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write(Log.opt.transaction && !Snapshot.current().sealed ? '║' : ' ', '-', `${this.hint()} is unsubscribed from ${info.memberHint}`)
    })
    this.subscriptions = undefined
  }

  private subscribeTo(subscription: Subscription, r: DataRevision, m: MemberName, h: DataHolder, timestamp: number): boolean {
    const ok = Operation.canSubscribe(subscription, r, m, h, timestamp)
    if (ok) {
      // Performance tracking
      let times: number = 0
      if (Hooks.repetitiveUsageWarningThreshold < Number.MAX_SAFE_INTEGER) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const existing = this.subscriptions!.get(subscription)
        times = existing ? existing.usageCount + 1 : 1
      }
      if (this.subscriptions !== undefined) {
        // Acquire observers
        if (!subscription.subscribers)
          subscription.subscribers = new Set<Operation>()
        // Two-way linking
        const info: SubscriptionInfo = { memberHint: Dump.rev2(h, r.snapshot, m), usageCount: times }
        subscription.subscribers.add(this)
        this.subscriptions!.set(subscription, info)
        if (Log.isOn && (Log.opt.read || this.options.logging?.read))
          Log.write('║', '  ∞ ', `${this.hint()} is subscribed to ${Dump.rev2(h, r.snapshot, m)}${info.usageCount > 1 ? ` (${info.usageCount} times)` : ''}`)
      }
      else if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write('║', '  x ', `${this.hint()} is obsolete and is NOT subscribed to ${Dump.rev2(h, r.snapshot, m)}`)
    }
    else {
      if (Log.isOn && (Log.opt.read || this.options.logging?.read))
        Log.write('║', '  x ', `${this.hint()} is NOT subscribed to already obsolete ${Dump.rev2(h, r.snapshot, m)}`)
    }
    return ok // || subscription.next === r
  }

  private static canSubscribe(subscription: Subscription, r: DataRevision, m: MemberName, h: DataHolder, timestamp: number): boolean {
    let result = !r.snapshot.sealed || subscription === h.head.data[m]
    if (result && timestamp !== -1)
      result = !(subscription instanceof Operation && timestamp >= subscription.obsoleteSince)
    return result
  }

  private static createOperation(h: DataHolder, m: MemberName, options: OptionsImpl): F<any> {
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
    const ctl = op ? op.controller : new OperationController(ROOT_HOLDER, m)
    const opts = op ? op.options : OptionsImpl.INITIAL
    initial[m] = op = new Operation(ctl, ROOT_REV.snapshot, new OptionsImpl(getter, setter, opts, options, implicit))
    // Add to the list if it's a reaction
    if (op.options.kind === Kind.Reaction && op.options.throttling < Number.MAX_SAFE_INTEGER) {
      const reactions = Meta.acquire(proto, Meta.Reactions)
      reactions[m] = op
    }
    else if (op.options.kind === Kind.Reaction && op.options.throttling >= Number.MAX_SAFE_INTEGER) {
      const reactions = Meta.getFrom(proto, Meta.Reactions)
      delete reactions[m]
    }
    return op.options
  }

  // static freeze(c: CachedResult): void {
  //   Utils.freezeMap(c.subscriptions)
  //   Object.freeze(c)
  // }

  static init(): void {
    Object.freeze(BOOT_ARGS)
    Log.getMergedLoggingOptions = getMergedLoggingOptions
    Dump.valueHint = valueHint
    Snapshot.markUsed = Operation.markUsed // override
    Snapshot.markEdited = Operation.markEdited // override
    Snapshot.isConflicting = Operation.isConflicting // override
    Snapshot.propagateAllChangesThroughSubscriptions = Operation.propagateAllChangesThroughSubscriptions // override
    Snapshot.revokeAllSubscriptions = Operation.revokeAllSubscriptions // override
    Snapshot.enqueueReactionsToRun = Operation.enqueueReactionsToRun
    Hooks.createOperation = Operation.createOperation // override
    Hooks.rememberOperationOptions = Operation.rememberOperationOptions // override
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
//   let subscription: Subscription = cause.revision.data[cause.memberName]
//   while (subscription instanceof Operation && subscription.obsoleteDueTo) {
//     full && result.push(Dump.rev(cause.revision, cause.memberName))
//     cause = subscription.obsoleteDueTo
//     subscription = cause.revision.data[cause.memberName]
//   }
//   result.push(Dump.rev(cause.revision, cause.memberName))
//   full && result.push(cause.revision.snapshot.hint)
//   return result
// }

function valueHint(value: any, m?: MemberName): string {
  let result: string = ''
  if (Array.isArray(value))
    result = `Array(${value.length})`
  else if (value instanceof Set)
    result = `Set(${value.size})`
  else if (value instanceof Map)
    result = `Map(${value.size})`
  else if (value instanceof Operation)
    result = `${Dump.rev2(value.controller.ownHolder, value.snapshot, m)}`
  else if (value === Meta.Disposed)
    result = '<disposed>'
  else if (value === Meta.Undefined)
    result = 'undefined'
  else if (typeof(value) === 'string')
    result = `"${value.toString().slice(0, 20)}"`
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 40)
  else
    result = 'undefined'
  return result
}

function getMergedLoggingOptions(local: Partial<LoggingOptions> | undefined): LoggingOptions {
  const t = Transaction.current
  let res = Log.merge(t.options.logging, t.id > 1 ? 31 + t.id % 6 : 37, t.id > 1 ? `T${t.id}` : `-${Snapshot.idGen.toString().replace(/[0-9]/g, '-')}`, Log.global)
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

function compareReactionsByOrder(a: Subscriber, b: Subscriber): number {
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
