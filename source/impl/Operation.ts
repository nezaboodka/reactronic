// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { MemberOptions, Kind, Reentrance, TraceOptions, SnapshotOptions } from '../Options'
import { Controller } from '../Controller'
import { ObjectRevision, MemberName, ObjectHolder, Observable, Observer, StandaloneMode, MemberInfo, Meta, AbstractSnapshot } from './Data'
import { Snapshot, Dump, ROOT_REV } from './Snapshot'
import { Transaction } from './Transaction'
import { Monitor, MonitorImpl } from './Monitor'
import { Hooks, OptionsImpl } from './Hooks'
import { TransactionJournalImpl } from './TransactionJournal'

const ROOT_ARGS: any[] = []
const ROOT_HOLDER = new ObjectHolder(undefined, undefined, Hooks.proxy, ROOT_REV, 'root-holder')
const ROOT_TRIGGER: MemberInfo = { revision: ROOT_REV, memberName: 'root-trigger', usageCount: 0 }

type OperationContext = {
  readonly operation: Operation
  readonly isUpToDate: boolean
  readonly snapshot: Snapshot
  readonly revision: ObjectRevision
}

export class OperationController extends Controller<any> {
  readonly ownHolder: ObjectHolder
  readonly memberName: MemberName

  configure(options: Partial<MemberOptions>): MemberOptions { return OperationController.configureImpl(this, options) }
  get options(): MemberOptions { return this.peek(undefined).operation.options }
  get nonreactive(): any { return this.peek(undefined).operation.value }
  get args(): ReadonlyArray<any> { return this.use().operation.args }
  get result(): any { return this.useOrRun(true, undefined).value }
  get error(): boolean { return this.use().operation.error }
  get stamp(): number { return this.use().revision.snapshot.timestamp }
  get isUpToDate(): boolean { return this.use().isUpToDate }
  markObsolete(): void { OperationController.markObsolete(this) }
  pullLastResult(args?: any[]): any { return this.useOrRun(true, args).value }

  constructor(ownHolder: ObjectHolder, memberName: MemberName) {
    super()
    this.ownHolder = ownHolder
    this.memberName = memberName
  }

  useOrRun(weak: boolean, args: any[] | undefined): Operation {
    let oc: OperationContext = this.peek(args)
    const ctx = oc.snapshot
    const op = oc.operation
    const rev = oc.revision
    const opts = op.options
    if (!oc.isUpToDate && rev.data[Meta.Disposed] === undefined
      && (!weak || op.episode <= 0 || !op.successor || op.successor.transaction.isFinished)) {
      const outerOpts = Operation.current?.options
      const standalone = weak || op.options.standalone ||
        (opts.kind === Kind.Transaction && outerOpts && (outerOpts.noSideEffects || outerOpts.kind === Kind.Cache)) ||
        op.options.kind === Kind.Cache && (
          rev.snapshot.sealed || (rev.snapshot !== ctx && rev.prev.revision !== ROOT_REV))
      const token = opts.noSideEffects ? this : undefined
      const oc2 = this.run(oc, standalone, opts, token, args)
      const ctx2 = oc2.operation.revision.snapshot
      if (!weak || ctx === ctx2 || (ctx2.sealed && ctx.timestamp >= ctx2.timestamp))
        oc = oc2
    }
    else if (Dbg.isOn && Dbg.trace.operation && (opts.trace === undefined ||
      opts.trace.operation === undefined || opts.trace.operation === true))
      Dbg.log(Transaction.current.isFinished ? '' : '║', '  <',
        `${Dump.rev(oc.revision, this.memberName)} result is reused from T${oc.operation.transaction.id}[${oc.operation.transaction.hint}]`)
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
    if (!op || op.transaction.isFinished)
      throw misuse('a method is expected with reactronic decorator')
    op.options = new OptionsImpl(op.options.getter, op.options.setter, op.options, options, false)
    if (Dbg.isOn && Dbg.trace.write)
      Dbg.log('║', '  ✎', `${op.hint()}.options are changed`)
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
    const op = Operation.current
    return op ? op.why() : ROOT_HOLDER.hint
  }

  static briefWhy(): string {
    const op = Operation.current
    return op ? op.briefWhy() : ROOT_HOLDER.hint
  }

  /* istanbul ignore next */
  static dependencies(): string[] {
    const op = Operation.current
    return op ? op.dependencies() : ['Reactronic.dependencies should be called from inside of reactive method']
  }

  // Internal

  private peek(args: any[] | undefined): OperationContext {
    const ctx = Snapshot.current()
    const r: ObjectRevision = ctx.seekRevision(this.ownHolder, this.memberName)
    const op: Operation = this.peekFromRevision(r)
    const isUpToDate = op.options.kind !== Kind.Transaction && op.episode >= 0 &&
      (!op.options.sensitiveArgs || args === undefined ||
        op.args.length === args.length && op.args.every((t, i) => t === args[i])) ||
      r.data[Meta.Disposed] !== undefined
    return { operation: op, isUpToDate, snapshot: ctx, revision: r }
  }

  private use(): OperationContext {
    const oc = this.peek(undefined)
    Snapshot.markUsed(oc.operation, oc.revision,
      this.memberName, this.ownHolder, oc.operation.options.kind, true)
    return oc
  }

  edit(): OperationContext {
    const h = this.ownHolder
    const m = this.memberName
    const ctx = Snapshot.edit()
    const r: ObjectRevision = ctx.getEditableRevision(h, m, Meta.Holder, this)
    let op: Operation = this.peekFromRevision(r)
    if (op.revision !== r) {
      const old = op
      op = r.data[m] = new Operation(this, r, op)
      Snapshot.markEdited(old, op, true, r, m, h)
    }
    return { operation: op, isUpToDate: true, snapshot: ctx, revision: r }
  }

  private peekFromRevision(r: ObjectRevision): Operation {
    const m = this.memberName
    let op: Operation = r.data[m]
    if (op.controller !== this) {
      const hint: string = Dbg.isOn ? `${Dump.obj(this.ownHolder, m)}/boot` : /* istanbul ignore next */ 'MethodController/init'
      const standalone = r.snapshot.sealed || r.prev.revision !== ROOT_REV
      op = Transaction.runAs<Operation>({ hint, standalone, token: this }, (): Operation => {
        const h = this.ownHolder
        let r2: ObjectRevision = Snapshot.current().getCurrentRevision(h, m)
        let op2 = r2.data[m] as Operation
        if (op2.controller !== this) {
          const old = op2
          r2 = Snapshot.edit().getEditableRevision(h, m, Meta.Holder, this)
          op2 = r2.data[m] = new Operation(this, r2, op2)
          Snapshot.markEdited(old, op2, true, r2, m, h)
        }
        return op2
      })
    }
    return op
  }

  private run(existing: OperationContext, standalone: StandaloneMode, options: MemberOptions, token: any, args: any[] | undefined): OperationContext {
    // TODO: Cleaner implementation is needed
    const hint: string = Dbg.isOn ? `${Dump.obj(this.ownHolder, this.memberName)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? ` - ${args[0]}` : ''}` : /* istanbul ignore next */ `${Dump.obj(this.ownHolder, this.memberName)}`
    let oc = existing
    const opts = { hint, standalone, journal: options.journal, trace: options.trace, token }
    const result = Transaction.runAs(opts, (argsx: any[] | undefined): any => {
      if (!oc.operation.transaction.isCanceled) { // first run
        oc = this.edit()
        if (Dbg.isOn && Dbg.trace.operation)
          Dbg.log('║', '  𝑓', `${oc.operation.why()}`)
        oc.operation.run(oc.snapshot, this.ownHolder.proxy, argsx)
      }
      else { // retry run
        oc = this.peek(argsx) // re-read on retry
        if (oc.operation.options.kind === Kind.Transaction || !oc.isUpToDate) {
          oc = this.edit()
          if (Dbg.isOn && Dbg.trace.operation)
            Dbg.log('║', '  𝑓', `${oc.operation.why()}`)
          oc.operation.run(oc.snapshot, this.ownHolder.proxy, argsx)
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
    const trigger: MemberInfo = { revision: ROOT_REV, memberName: self.memberName, usageCount: 0 }
    oc.operation.markObsoleteDueTo(0, oc.operation, trigger, ctx, ctx.timestamp, ctx.reactions)
  }
}

// Operation

class Operation extends Observable implements Observer {
  static current?: Operation = undefined
  static deferredReactions: Operation[] = []

  readonly transaction: Transaction
  readonly controller: OperationController
  readonly revision: ObjectRevision
  observables: Map<Observable, MemberInfo> | undefined
  options: OptionsImpl
  trigger: MemberInfo | undefined
  args: any[]
  result: any
  error: any
  episode: number
  started: number
  margin: number
  successor: Operation | undefined

  constructor(controller: OperationController, revision: ObjectRevision, prev: Operation | OptionsImpl) {
    super(undefined)
    this.transaction = Transaction.current
    this.controller = controller
    this.revision = revision
    this.observables = new Map<Observable, MemberInfo>()
    if (prev instanceof Operation) {
      this.options = prev.options
      this.trigger = prev.trigger
      this.args = prev.args
      this.result = prev.result
      this.error = prev.error
      this.value = prev.value
      this.successor = prev.successor
    }
    else { // prev: OptionsImpl
      this.options = prev
      this.trigger = undefined
      this.args = ROOT_ARGS
      this.result = undefined
      this.error = undefined
      this.value = undefined
      this.successor = undefined
    }
    this.episode = -1 // means not yet computed
    this.started = 0
    this.margin = 0
  }

  get isOperation(): boolean { return true } // override
  get selfSnapshotId(): number { return this.revision.snapshot.id } // override
  hint(): string { return `${Dump.rev(this.revision, this.controller.memberName)}` } // override
  get standalone(): StandaloneMode { return this.options.standalone }
  get order(): number { return this.options.order }

  why(): string {
    let ms: number = Date.now()
    const prev = this.revision.prev.revision.data[this.controller.memberName]
    if (prev instanceof Operation)
      ms = prev.started !== 0 ? Math.abs(this.started || ms) - Math.abs(prev.started) : Infinity
    let trigger: string
    if (this.trigger)
      trigger = `   <<   ${propagationHint(this.trigger, true).join('   <<   ')}`
    else if (this.controller.options.kind === Kind.Transaction)
      trigger = '   <<   operation'
    else
      trigger = `   <<   T${this.revision.snapshot.id}[${this.revision.snapshot.hint}]`
    return `${this.hint()}${trigger}   (${ms !== Infinity ? `${ms}ms since previous run` : 'initial run'})`
  }

  briefWhy(): string {
    return this.trigger ? propagationHint(this.trigger, false)[0] : ROOT_HOLDER.hint
  }

  dependencies(): string[] {
    throw misuse('not implemented yet')
  }

  wrap<T>(func: F<T>): F<T> {
    const wrappedForOperation: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.step && this.result)
        Dbg.logAs({margin2: this.margin}, '║', '‾\\', `${this.hint()} - step in  `, 0, '        │')
      const started = Date.now()
      const result = OperationController.runWithin<T>(this, func, ...args)
      const ms = Date.now() - started
      if (Dbg.isOn && Dbg.trace.step && this.result)
        Dbg.logAs({margin2: this.margin}, '║', '_/', `${this.hint()} - step out `, 0, this.episode >= 0 ? '        │' : '')
      if (ms > Hooks.mainThreadBlockingWarningThreshold) /* istanbul ignore next */
        Dbg.log('', '[!]', this.why(), ms, '    *** main thread is too busy ***')
      return result
    }
    return wrappedForOperation
  }

  run(snapshot: Snapshot, proxy: any, args: any[] | undefined): void {
    this.episode = snapshot.episode
    this.margin = Operation.current ? Operation.current.margin + 1 : 1
    if (args)
      this.args = args
    if (!this.error)
      OperationController.runWithin<void>(this, Operation.run, this, proxy)
    else
      this.result = Promise.reject(this.error)
  }

  markObsoleteDueTo(bubbling: number, observable: Observable, trigger: MemberInfo, snapshot: AbstractSnapshot, since: number, reactions: Observer[]): void {
    const other = this.revision.snapshot !== trigger.revision.snapshot
    if (other || this.episode >= 0) {
      const op = other ? this.controller.edit().operation : this
      const triggerEpisode = trigger.revision.changes.get(trigger.memberName) ?? 0
      if (snapshot !== trigger.revision.snapshot || bubbling > 0 || (op.episode >= -1 && op.episode < triggerEpisode)) {
        // Mark obsolete
        const isReaction = op.options.kind === Kind.Reaction
        op.trigger = trigger
        op.started = 0
        op.episode = -2 // -2 means marked obsolete

        // Logging
        if (Dbg.isOn && (Dbg.trace.obsolete || op.options.trace?.obsolete))
          Dbg.log(Dbg.trace.transaction && !Snapshot.current().sealed ? '║' : ' ', isReaction ? '  █' : '  ▒',
            isReaction && trigger.revision === ROOT_REV
              ? `${op.hint()} is a reaction and will run automatically (order ${op.options.order})`
              : `${this.hint()} became obsolete due to ${Dump.rev(trigger.revision, trigger.memberName)} since v${since}/e${triggerEpisode}${isReaction ? ` and will run automatically (order ${op.options.order})` : ''}`)

        // Stop cascade propagation on reaction, or continue otherwise
        if (isReaction)
          reactions.push(op)
        else
          op.observers?.forEach(c => c.markObsoleteDueTo(bubbling + 1, op, { revision: op.revision, memberName: op.controller.memberName, usageCount: 0 }, snapshot, since, reactions))

        // Cancel own transaction if it is still in progress
        const tran = this.transaction
        if (tran.snapshot !== snapshot && !tran.isFinished && op !== observable) // restart after itself if canceled
          if (!tran.isFinished && op !== observable) // restart after itself if canceled
            tran.cancel(new Error(`T${tran.id}[${tran.hint}] is canceled due to obsolete ${Dump.rev(trigger.revision, trigger.memberName)} changed by T${trigger.revision.snapshot.id}[${trigger.revision.snapshot.hint}]`), null)
      }
      else if (op.episode >= 0) {
        if (Dbg.isOn && (Dbg.trace.read || this.options.trace?.read))
          Dbg.log(' ', 'x', `${this.hint()} is not obsolete due to its own change to ${Dump.rev(trigger.revision, trigger.memberName)}`)
      }
    }
  }

  runIfNotUpToDate(reactions: Observer[] | undefined): void
  {
    this.refreshIfNotUpToDateImpl(false, reactions)
  }

  private refreshIfNotUpToDateImpl(now: boolean, reactions: Observer[] | undefined): void {
    const o = this.options
    if (o.standalone === false || reactions === undefined) {
      const t = o.throttling
      const interval = Date.now() + this.started // "started" is stored as negative value after reaction completion
      const hold = t ? t - interval : 0 // "started" is stored as negative value after reaction completion
      if (now || hold < 0) {
        if (!this.error && (o.kind === Kind.Transaction ||
          !this.successor || this.successor.transaction.isCanceled)) {
          try {
            const op: Operation = this.controller.useOrRun(false, undefined)
            if (op.result instanceof Promise)
              op.result.catch(error => {
                if (op.options.kind === Kind.Reaction)
                  misuse(`reaction ${op.hint()} failed and will not run anymore: ${error}`, error)
              })
          }
          catch (e) {
            if (reactions !== undefined)
              throw e
            else if (o.kind === Kind.Reaction)
              misuse(`reaction ${this.hint()} failed and will not run anymore: ${e}`, e)
          }
        }
      }
      else if (t < Number.MAX_SAFE_INTEGER) {
        if (hold > 0)
          setTimeout(() => this.refreshIfNotUpToDateImpl(true, undefined), hold)
        else
          this.addToDeferredReactions()
      }
    }
    else
      reactions.push(this) // return standalone reaction back to the queue
  }

  checkReentranceOver(head: Operation): this {
    let error: Error | undefined = undefined
    const opponent = head.successor
    if (opponent && (opponent !== this || opponent.episode >= 0) &&
      opponent.transaction !== this.transaction && !opponent.transaction.isFinished) {
      if (Dbg.isOn && Dbg.trace.operation)
        Dbg.log('║', ' [!]', `${this.hint()} is trying to re-enter over ${opponent.hint()}`)
      switch (head.options.reentrance) {
        case Reentrance.PreventWithError:
          if (!opponent.transaction.isCanceled)
            throw misuse(`${this.hint()} cannot reenter over ${opponent.hint()}`)
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
    const prev = this.revision.prev.revision.data[this.controller.memberName]
    if (prev !== undefined)
      this.checkReentranceOver(prev)
    if (this.options.monitor)
      this.monitorEnter(this.options.monitor)
    if (Dbg.isOn && Dbg.trace.operation)
      Dbg.log('║', '‾\\', `${this.hint()} - enter`, undefined, `    [ ${Dump.obj(this.controller.ownHolder, this.controller.memberName)} ]`)
    this.started = Date.now()
  }

  private leaveOrAsync(): void {
    if (this.result instanceof Promise) {
      this.result = this.result.then(
        value => {
          this.value = value
          this.error = undefined
          this.leave(false, '  ⚐', '- finished  ', ' OK ──┘')
          return value
        },
        error => {
          this.value = undefined
          this.error = error
          this.leave(false, '  ⚐', '- finished  ', 'ERR ──┘')
          throw error
        })
      if (Dbg.isOn) {
        if (Dbg.trace.operation)
          Dbg.log('║', '_/', `${this.hint()} - leave... `, 0, 'ASYNC ──┐')
        else if (Dbg.trace.transaction)
          Dbg.log('║', '  ', `${this.why()} ...`, 0, 'ASYNC')
      }
    }
    else {
      this.value = this.result
      this.error = undefined
      this.leave(true, '_/', '- leave')
    }
  }

  private leave(main: boolean, op: string, message: string, highlight: string | undefined = undefined): void {
    const ms: number = Date.now() - this.started
    this.started = -this.started
    if (Dbg.isOn && Dbg.trace.operation)
      Dbg.log('║', `${op}`, `${this.hint()} ${message}`, ms, highlight)
    if (ms > (main ? Hooks.mainThreadBlockingWarningThreshold : Hooks.asyncActionDurationWarningThreshold)) /* istanbul ignore next */
      Dbg.log('', '[!]', this.why(), ms, main ? '    *** main thread is too busy ***' : '    *** async is too long ***')
    if (this.options.monitor)
      this.monitorLeave(this.options.monitor)
    // CachedResult.freeze(this)
  }

  private monitorEnter(mon: Monitor): void {
    const options: SnapshotOptions = {
      hint: 'Monitor.enter',
      standalone: 'isolated',
      trace: Dbg.isOn && Dbg.trace.monitor ? undefined : Dbg.global }
    OperationController.runWithin<void>(undefined, Transaction.runAs, options,
      MonitorImpl.enter, mon, this.transaction)
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.standalone<void>(() => {
      const leave = (): void => {
        const options: SnapshotOptions = {
          hint: 'Monitor.leave',
          standalone: 'isolated',
          trace: Dbg.isOn && Dbg.trace.monitor ? undefined : Dbg.DefaultLevel }
        OperationController.runWithin<void>(undefined, Transaction.runAs, options,
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
      x.runIfNotUpToDate(undefined)
  }

  private static markUsed(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, kind: Kind, weak: boolean): void {
    if (kind !== Kind.Transaction) {
      const op: Operation | undefined = Operation.current // alias
      if (op && op.options.kind !== Kind.Transaction && m !== Meta.Holder) {
        const ctx = Snapshot.current()
        if (ctx !== r.snapshot) // snapshot should not bump itself
          ctx.bumpBy(r.snapshot.timestamp)
        const t = weak ? -1 : ctx.timestamp
        if (!op.subscribeTo(observable, r, m, h, t))
          op.markObsoleteDueTo(0, observable, { revision: r, memberName: m, usageCount: 0 }, ctx, ctx.timestamp, ctx.reactions)
      }
    }
  }

  private static markEdited(oldValue: any, newValue: any, edited: boolean, r: ObjectRevision, m: MemberName, h: ObjectHolder): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    edited ? r.changes.set(m, r.snapshot.episode) : r.changes.delete(m)
    if (Dbg.isOn && Dbg.trace.write)
      edited ? Dbg.log('║', '  ✎', `${Dump.rev(r, m)} is changed from ${valueHint(oldValue, m)} to ${valueHint(newValue, m)}`) : Dbg.log('║', '  ✎', `${Dump.rev(r, m)} is changed from ${valueHint(oldValue, m)} to ${valueHint(newValue, m)}`, undefined, ' (same as previous)')
  }

  private static isConflicting(theirValue: any, ourPrevValue: any, ourValue: any): boolean {
    let result = theirValue !== ourPrevValue
    if (result && theirValue instanceof Operation && ourPrevValue instanceof Operation)
      result = theirValue.result !== ourPrevValue.result
    return result
  }

  // private static isConflicting(theirValue: any, ourPrevValue: any, ourValue: any): boolean {
  //   let result = theirValue !== ourPrevValue
  //   if (result && theirValue instanceof Operation && ourPrevValue instanceof Operation && ourValue instanceof Operation)
  //     result = ourValue.episode > -1 && (theirValue.episode >= 0 || theirValue.result !== ourPrevValue.result)
  //   return result
  // }

  // Original:
  // private static isConflicting(oldValue: any, newValue: any): boolean {
  //   let result = oldValue !== newValue
  //   if (result)
  //     result = oldValue instanceof Operation && oldValue.cause !== ROOT_TRIGGER
  //   return result
  // }

  private static propagateAllChangesThroughSubscriptions(snapshot: Snapshot): void {
    const since = snapshot.timestamp
    const reactions = snapshot.reactions
    snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
      const ph = r.changes.get(Meta.Disposed)
      if (ph === undefined)
        r.changes.forEach((episode, m) =>
          Operation.propagateMemberChangeThroughSubscriptions(
            snapshot, false, since, r, m, h, episode, reactions))
      else
        for (const m in r.prev.revision.data)
          Operation.propagateMemberChangeThroughSubscriptions(
            snapshot, false, since, r, m, h, ph, reactions)
    })
    reactions.sort(compareReactions)
  }

  private static revokeAllSubscriptions(snapshot: Snapshot): void {
    snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) =>
      r.changes.forEach((episode, m) => Operation.propagateMemberChangeThroughSubscriptions(
        snapshot, true, snapshot.timestamp, r, m, h, 0, undefined)))
  }

  private static propagateMemberChangeThroughSubscriptions(
    snapshot: Snapshot, unsubscribe: boolean, timestamp: number,
    r: ObjectRevision, m: MemberName, h: ObjectHolder, episode: number, reactions?: Observer[]): void {
    if (reactions) {
      // Propagate change to reactions
      const prev = r.prev.revision.data[m]
      if (prev !== undefined && prev instanceof Observable) {
        const trigger: MemberInfo = { revision: r, memberName: m, usageCount: 0 }
        prev.observers?.forEach(c => c.markObsoleteDueTo(0, prev, trigger, snapshot, timestamp, reactions))
      }
    }
    const curr = r.data[m]
    if (curr instanceof Operation) {
      if (curr.revision === r && curr.observables !== undefined) {
        // TODO: Rerun reactions after pause
        // if (reactions && r.prev.revision !== ROOT_REV && curr.started === 0 && curr.options.throttling < Number.MAX_SAFE_INTEGER)
        //   reactions.push(curr)
        if (Hooks.repetitiveUsageWarningThreshold < Number.MAX_SAFE_INTEGER) {
          curr.observables.forEach((hint, v) => { // performance tracking info
            if (hint.usageCount > Hooks.repetitiveUsageWarningThreshold)
              Dbg.log('', '[!]', `${curr.hint()} uses ${Dump.rev(hint.revision, hint.memberName)} ${hint.usageCount} times (consider remembering it in a local variable)`, 0, ' *** WARNING ***')
          })
        }
        if (unsubscribe)
          curr.unsubscribeFromAllObservables()
      }
    }
    else if (curr instanceof Observable && curr.observers) {
      // TODO: Take EPISODE into account
      // Unsubscribe from own-changed observables
      let preserved: Set<Observer> | undefined = undefined
      curr.observers.forEach(o => {
        if (episode < o.episode) {
          if (preserved === undefined)
            preserved = new Set<Observer>()
          preserved.add(o)
        }
        else if (episode === o.episode) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          o.observables!.delete(curr)
          if (Dbg.isOn && Dbg.trace.read)
            Dbg.log(Dbg.trace.transaction && !Snapshot.current().sealed ? '║' : ' ', '-', `${o.hint()} is unsubscribed from own-changed ${Dump.rev(r, m)} (change episode ${episode}, observer episode ${o.episode})`)
        }
        else if (reactions) {
          const trigger: MemberInfo = { revision: r, memberName: m, usageCount: 0 }
          o.markObsoleteDueTo(0, curr, trigger, snapshot, timestamp, reactions)
        }
      })
      curr.observers = preserved
    }
  }

  private unsubscribeFromAllObservables(): void {
    // It's critical to have no exceptions here
    this.observables?.forEach((hint, value) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value.observers!.delete(this)
      if (Dbg.isOn && (Dbg.trace.read || this.options.trace?.read))
        Dbg.log(Dbg.trace.transaction && !Snapshot.current().sealed ? '║' : ' ', '-', `${this.hint()} is unsubscribed from ${Dump.rev(hint.revision, hint.memberName)}`)
    })
    this.observables = undefined
  }

  private subscribeTo(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, timestamp: number): boolean {
    const ok = Operation.canSubscribeTo(observable, r, m, h, timestamp)
    if (ok) {
      // Performance tracking
      let times: number = 0
      if (Hooks.repetitiveUsageWarningThreshold < Number.MAX_SAFE_INTEGER) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const existing = this.observables!.get(observable)
        times = existing ? existing.usageCount + 1 : 1
      }
      // Acquire observers
      if (!observable.observers)
        observable.observers = new Set<Operation>()
      // Two-way linking
      const info: MemberInfo = { revision: r, memberName: m, usageCount: times }
      observable.observers.add(this)
      this.observables?.set(observable, info)
      if (Dbg.isOn && (Dbg.trace.read || this.options.trace?.read))
        Dbg.log('║', '  +', `${this.hint()} is subscribed to ${Dump.rev(r, m)}${info.usageCount > 1 ? ` (${info.usageCount} times)` : ''}`)
    }
    else if (Dbg.isOn && (Dbg.trace.read || this.options.trace?.read))
      Dbg.log('║', '  x', `${this.hint()} is NOT subscribed to already obsolete ${Dump.rev(r, m)}`)
    return ok
  }

  private static canSubscribeTo(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, timestamp: number): boolean {
    let result = !r.snapshot.sealed || observable === h.head.data[m]
    if (result && timestamp !== -1)
      result = !(observable instanceof Operation && observable.observables === undefined)
    return result
  }

  private static createControllerAndGetHook(h: ObjectHolder, m: MemberName, options: OptionsImpl): F<any> {
    const ctl = new OperationController(h, m)
    const hook: F<any> = (...args: any[]): any => {
      return ctl.useOrRun(false, args).result
    }
    Meta.set(hook, Meta.Controller, ctl)
    return hook
  }

  private static rememberOperationOptions(proto: any, m: MemberName, getter: Function | undefined, setter: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<MemberOptions>, implicit: boolean): OptionsImpl {
    // Configure options
    const initial: any = Meta.acquire(proto, Meta.Initial)
    let op: Operation | undefined = initial[m]
    const ctl = op ? op.controller : new OperationController(ROOT_HOLDER, m)
    const opts = op ? op.options : OptionsImpl.INITIAL
    initial[m] = op = new Operation(ctl, ROOT_REV, new OptionsImpl(getter, setter, opts, options, implicit))
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
  //   Utils.freezeMap(c.observables)
  //   Object.freeze(c)
  // }

  static init(): void {
    Object.freeze(ROOT_ARGS)
    Object.freeze(ROOT_TRIGGER)
    Dbg.getMergedTraceOptions = getMergedTraceOptions
    Snapshot.markUsed = Operation.markUsed // override
    Snapshot.markEdited = Operation.markEdited // override
    Snapshot.isConflicting = Operation.isConflicting // override
    Snapshot.propagateAllChangesThroughSubscriptions = Operation.propagateAllChangesThroughSubscriptions // override
    Snapshot.revokeAllSubscriptions = Operation.revokeAllSubscriptions // override
    Snapshot.createPatch = TransactionJournalImpl.createPatch
    Hooks.createControllerAndGetHook = Operation.createControllerAndGetHook // override
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

function propagationHint(trigger: MemberInfo, full: boolean): string[] {
  const result: string[] = []
  let observable: Observable = trigger.revision.data[trigger.memberName]
  while (observable instanceof Operation && observable.successor?.trigger) {
    full && result.push(Dump.rev(trigger.revision, trigger.memberName))
    trigger = observable.successor.trigger
    observable = trigger.revision.data[trigger.memberName]
  }
  result.push(Dump.rev(trigger.revision, trigger.memberName))
  full && result.push(trigger.revision.snapshot.hint)
  return result
}

function valueHint(value: any, m?: MemberName): string {
  let result: string = ''
  if (Array.isArray(value))
    result = `Array(${value.length})`
  else if (value instanceof Set)
    result = `Set(${value.size})`
  else if (value instanceof Map)
    result = `Map(${value.size})`
  else if (value instanceof Operation)
    result = `${Dump.rev(value.revision, m)}`
  else if (value === Meta.Disposed)
    result = '<disposed>'
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 20)
  else
    result = '∅'
  return result
}

function getMergedTraceOptions(local: Partial<TraceOptions> | undefined): TraceOptions {
  const t = Transaction.current
  let res = Dbg.merge(t.options.trace, t.id > 1 ? 31 + t.id % 6 : 37, t.id > 1 ? `T${t.id}` : `-${Snapshot.idGen.toString().replace(/[0-9]/g, '-')}`, Dbg.global)
  res = Dbg.merge({margin1: t.margin}, undefined, undefined, res)
  if (Operation.current)
    res = Dbg.merge({margin2: Operation.current.margin}, undefined, undefined, res)
  if (local)
    res = Dbg.merge(local, undefined, undefined, res)
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

function compareReactions(a: Observer, b: Observer): number {
  return a.order - b.order
  // let result: number
  // if (a.standalone === false)
  //   result = b.standalone === false ? a.order - b.order : -1
  // else
  //   result = b.standalone === false ? 1 : a.order - b.order
  // return result
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
