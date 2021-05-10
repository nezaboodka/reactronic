// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { MethodOptions, Kind, Reentrance, TraceOptions, SnapshotOptions } from '../Options'
import { Worker } from '../Worker'
import { Controller } from '../Controller'
import { ObjectRevision, MemberName, ObjectHolder, Observable, Observer, MemberInfo, Meta } from './Data'
import { Snapshot, Hints, NIL_REV, INIT_TIMESTAMP, MAX_TIMESTAMP } from './Snapshot'
import { Transaction } from './Transaction'
import { Monitor, MonitorImpl } from './Monitor'
import { Hooks, OptionsImpl } from './Hooks'
import { TransactionJournalImpl } from './TransactionJournal'

const NIL_HOLDER = new ObjectHolder(undefined, undefined, Hooks.proxy, NIL_REV, 'N/A')

type CallCtx = { op: Operation, isUpToDate: boolean, snapshot: Snapshot, revision: ObjectRevision }

export class ControllerImpl extends Controller<any> {
  readonly ownHolder: ObjectHolder
  readonly memberName: MemberName

  configure(options: Partial<MethodOptions>): MethodOptions { return ControllerImpl.configureImpl(this, options) }
  get options(): MethodOptions { return this.peek(undefined).op.options }
  get nonreactive(): any { return this.peek(undefined).op.value }
  get args(): ReadonlyArray<any> { return this.use().op.args }
  get result(): any { return this.invoke(true, undefined).value }
  get error(): boolean { return this.use().op.error }
  get stamp(): number { return this.use().revision.snapshot.timestamp }
  get isUpToDate(): boolean { return this.use().isUpToDate }
  markObsolete(): void { Transaction.runAs({ hint: Dbg.isOn ? `markObsolete(${Hints.obj(this.ownHolder, this.memberName)})` : 'markObsolete()' }, ControllerImpl.markObsolete, this) }
  pullLastResult(args?: any[]): any { return this.invoke(true, args).value }

  constructor(ownHolder: ObjectHolder, memberName: MemberName) {
    super()
    this.ownHolder = ownHolder
    this.memberName = memberName
  }

  invoke(weak: boolean, args: any[] | undefined): Operation {
    let cc: CallCtx = this.peek(args)
    const ctx = cc.snapshot
    const op: Operation = cc.op
    if (!cc.isUpToDate && cc.revision.data[Meta.Disposed] === undefined
      && (!weak || op.obsoleteSince === INIT_TIMESTAMP || !op.successor || op.successor.transaction.isFinished)) {
      const opt = op.options
      const spawn = weak || opt.kind === Kind.Reaction ||
        (opt.kind === Kind.Cache && (cc.revision.snapshot.sealed || cc.revision.prev.revision !== NIL_REV))
      const token = opt.noSideEffects ? this : undefined
      const ic2 = this.run(cc, spawn, opt, token, args)
      const ctx2 = ic2.op.revision.snapshot
      if (!weak || ctx === ctx2 || (ctx2.sealed && ctx.timestamp >= ctx2.timestamp))
        cc = ic2
    }
    else if (Dbg.isOn && Dbg.trace.method && (op.options.trace === undefined || op.options.trace.method === undefined || op.options.trace.method === true))
      Dbg.log(Transaction.current.isFinished ? '' : '║', ' (=)', `${Hints.rev(cc.revision, this.memberName)} result is reused from T${cc.op.transaction.id}[${cc.op.transaction.hint}]`)
    const t = cc.op
    Snapshot.markUsed(t, cc.revision, this.memberName, this.ownHolder, t.options.kind, weak)
    return t
  }

  static of(method: F<any>): Controller<any> {
    const ctl = Meta.get<Controller<any> | undefined>(method, Meta.Method)
    if (!ctl)
      throw misuse(`given method is not decorated as reactronic one: ${method.name}`)
    return ctl
  }

  static configureImpl(self: ControllerImpl | undefined, options: Partial<MethodOptions>): MethodOptions {
    let op: Operation | undefined
    if (self)
      op = self.edit().op
    else
      op = Operation.current
    if (!op || op.transaction.isFinished)
      throw misuse('a method is expected with reactronic decorator')
    op.options = new OptionsImpl(op.options.body, op.options, options, false)
    if (Dbg.isOn && Dbg.trace.write)
      Dbg.log('║', '  ♦', `${op.hint()}.options = ...`)
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
    return op ? op.why() : NIL_HOLDER.hint
  }

  static briefWhy(): string {
    const op = Operation.current
    return op ? op.briefWhy() : NIL_HOLDER.hint
  }

  /* istanbul ignore next */
  static dependencies(): string[] {
    const op = Operation.current
    return op ? op.dependencies() : ['Reactronic.deps should be called from inside of reactive method']
  }

  // Internal

  private peek(args: any[] | undefined): CallCtx {
    const ctx = Snapshot.current()
    const r: ObjectRevision = ctx.findRevOf(this.ownHolder, this.memberName)
    const op: Operation = this.peekFromRev(r)
    const isValid = op.options.kind !== Kind.Operation && op.obsoleteSince !== INIT_TIMESTAMP &&
      (ctx === op.revision.snapshot || ctx.timestamp < op.obsoleteSince) &&
      (!op.options.sensitiveArgs || args === undefined || op.args.length === args.length && op.args.every((t, i) => t === args[i])) ||
      r.data[Meta.Disposed] !== undefined
    return { op, isUpToDate: isValid, snapshot: ctx, revision: r }
  }

  private use(): CallCtx {
    const cc = this.peek(undefined)
    Snapshot.markUsed(cc.op, cc.revision,
      this.memberName, this.ownHolder, cc.op.options.kind, true)
    return cc
  }

  private edit(): CallCtx {
    const h = this.ownHolder
    const m = this.memberName
    const ctx = Snapshot.edit()
    const r: ObjectRevision = ctx.getEditableRevision(h, m, Meta.Holder, this)
    let op: Operation = this.peekFromRev(r)
    if (op.revision !== r) {
      const op2 = new Operation(this, r, op)
      op = r.data[m] = op2.reenterOver(op)
      ctx.bumpBy(r.prev.revision.snapshot.timestamp)
      Snapshot.markEdited(op, true, r, m, h)
    }
    return { op, isUpToDate: true, snapshot: ctx, revision: r }
  }

  private peekFromRev(r: ObjectRevision): Operation {
    const m = this.memberName
    let op: Operation = r.data[m]
    if (op.controller !== this) {
      const hint: string = Dbg.isOn ? `${Hints.obj(this.ownHolder, m)}/init` : /* istanbul ignore next */ 'MethodController/init'
      const spawn = r.snapshot.sealed || r.prev.revision !== NIL_REV
      op = Transaction.runAs<Operation>({ hint, spawn, token: this }, (): Operation => {
        const h = this.ownHolder
        let r2: ObjectRevision = Snapshot.current().getCurrentRevision(h, m)
        let op2 = r2.data[m] as Operation
        if (op2.controller !== this) {
          r2 = Snapshot.edit().getEditableRevision(h, m, Meta.Holder, this)
          op2 = r2.data[m] = new Operation(this, r2, op2)
          op2.obsoleteSince = INIT_TIMESTAMP // indicates blank value
          Snapshot.markEdited(op2, true, r2, m, h)
        }
        return op2
      })
    }
    return op
  }

  private run(existing: CallCtx, spawn: boolean, options: MethodOptions, token: any, args: any[] | undefined): CallCtx {
    // TODO: Cleaner implementation is needed
    const hint: string = Dbg.isOn ? `${Hints.obj(this.ownHolder, this.memberName)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? ` - ${args[0]}` : ''}` : /* istanbul ignore next */ `${Hints.obj(this.ownHolder, this.memberName)}`
    let cc = existing
    const opt = { hint, spawn, journal: options.journal, trace: options.trace, token }
    const result = Transaction.runAs(opt, (argsx: any[] | undefined): any => {
      if (!cc.op.transaction.isCanceled) { // first invoke
        cc = this.edit()
        if (Dbg.isOn && (Dbg.trace.transaction || Dbg.trace.method || Dbg.trace.obsolete))
          Dbg.log('║', ' (f)', `${cc.op.why()}`)
        cc.op.run(this.ownHolder.proxy, argsx)
      }
      else { // retry invoke
        cc = this.peek(argsx) // re-read on retry
        if (cc.op.options.kind === Kind.Operation || !cc.isUpToDate) {
          cc = this.edit()
          if (Dbg.isOn && (Dbg.trace.transaction || Dbg.trace.method || Dbg.trace.obsolete))
            Dbg.log('║', ' (f)', `${cc.op.why()}`)
          cc.op.run(this.ownHolder.proxy, argsx)
        }
      }
      return cc.op.result
    }, args)
    cc.op.result = result
    return cc
  }

  private static markObsolete(self: ControllerImpl): void {
    const cc = self.peek(undefined)
    const ctx = cc.snapshot
    cc.op.markObsoleteDueTo(cc.op, {revision: NIL_REV, member: self.memberName, times: 0}, ctx.timestamp, ctx.reactions)
  }
}

// Operation

class Operation extends Observable implements Observer {
  static current?: Operation = undefined
  static asyncReactionsBatch: Operation[] = []

  readonly margin: number
  readonly transaction: Worker
  readonly controller: ControllerImpl
  readonly revision: ObjectRevision
  readonly observables: Map<Observable, MemberInfo>
  options: OptionsImpl
  cause: MemberInfo | undefined
  args: any[]
  result: any
  error: any
  started: number
  obsoleteDueTo: MemberInfo | undefined
  obsoleteSince: number
  successor: Operation | undefined

  constructor(controller: ControllerImpl, revision: ObjectRevision, prev: Operation | OptionsImpl) {
    super(undefined)
    this.margin = Operation.current ? Operation.current.margin + 1 : 1
    this.transaction = Transaction.current
    this.controller = controller
    this.revision = revision
    this.observables = new Map<Observable, MemberInfo>()
    if (prev instanceof Operation) {
      this.options = prev.options
      this.args = prev.args
      // this.value = init.value
      this.cause = prev.obsoleteDueTo
    }
    else { // init instanceof OptionsImpl
      this.options = prev
      this.args = []
      this.cause = undefined
      // this.value = undefined
    }
    // this.ret = undefined
    // this.error = undefined
    this.started = 0
    this.obsoleteSince = 0
    this.obsoleteDueTo = undefined
    this.successor = undefined
  }

  get isOperation(): boolean { return true } // override
  hint(): string { return `${Hints.rev(this.revision, this.controller.memberName)}` } // override
  get priority(): number { return this.options.priority }

  why(): string {
    let ms: number = Date.now()
    const prev = this.revision.prev.revision.data[this.controller.memberName]
    if (prev instanceof Operation)
      ms = Math.abs(this.started) - Math.abs(prev.started)
    let cause: string
    if (this.cause)
      cause = `   <<   ${propagationHint(this.cause, true).join('   <<   ')}`
    else if (this.controller.options.kind === Kind.Operation)
      cause = '   <<   operation'
    else
      cause = `   <<   called within ${this.revision.snapshot.hint}`
    return `${this.hint()}${cause}   (${ms}ms since previous revalidation)`
  }

  briefWhy(): string {
    return this.cause ? propagationHint(this.cause, false)[0] : NIL_HOLDER.hint
  }

  dependencies(): string[] {
    throw misuse('not implemented yet')
  }

  bind<T>(func: F<T>): F<T> {
    const boundFunc: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.step && this.result)
        Dbg.logAs({margin2: this.margin}, '║', '‾\\', `${this.hint()} - step in  `, 0, '        │')
      const started = Date.now()
      const result = ControllerImpl.runWithin<T>(this, func, ...args)
      const ms = Date.now() - started
      if (Dbg.isOn && Dbg.trace.step && this.result)
        Dbg.logAs({margin2: this.margin}, '║', '_/', `${this.hint()} - step out `, 0, this.started > 0 ? '        │' : '')
      if (ms > Hooks.mainThreadBlockingWarningThreshold) /* istanbul ignore next */
        Dbg.log('', '[!]', this.why(), ms, '    *** main thread is too busy ***')
      return result
    }
    return boundFunc
  }

  run(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.obsoleteSince = MAX_TIMESTAMP
    if (!this.error)
      ControllerImpl.runWithin<void>(this, Operation.run, this, proxy)
    else
      this.result = Promise.reject(this.error)
  }

  markObsoleteDueTo(observable: Observable, cause: MemberInfo, since: number, reactions: Observer[]): void {
    if (this.obsoleteSince === MAX_TIMESTAMP || this.obsoleteSince <= 0) {
      const skip = !observable.isOperation &&
        cause.revision.snapshot === this.revision.snapshot &&
        cause.revision.members.has(cause.member)
      if (!skip) {
        this.obsoleteDueTo = cause
        this.obsoleteSince = since
        const isReaction = this.options.kind === Kind.Reaction /*&& this.revision.data[Meta.Disposed] === undefined*/
        if (Dbg.isOn && (Dbg.trace.obsolete || this.options.trace?.obsolete))
          Dbg.log(Dbg.trace.transaction && !Snapshot.current().sealed ? '║' : ' ', isReaction ? '█' : '▒', isReaction && cause.revision === NIL_REV ? `${this.hint()} is a reaction and will run automatically (priority ${this.options.priority})` : `${this.hint()} is obsoleted due to ${Hints.rev(cause.revision, cause.member)} since v${since}${isReaction ? ` and will run automatically (priority ${this.options.priority})` : ''}`)
        this.unsubscribeFromAll()
        if (isReaction) // stop cascade outdating on reaction
          reactions.push(this)
        else if (this.observers) // cascade outdating
          this.observers.forEach(c => c.markObsoleteDueTo(this, {revision: this.revision, member: this.controller.memberName, times: 0}, since, reactions))
        const tran = this.transaction
        if (!tran.isFinished && this !== observable) // restart after itself if canceled
          tran.cancel(new Error(`T${tran.id}[${tran.hint}] is canceled due to outdating by ${Hints.rev(cause.revision, cause.member)}`), null)
      }
      else {
        if (Dbg.isOn && (Dbg.trace.obsolete || this.options.trace?.obsolete))
          Dbg.log(' ', 'x', `${this.hint()} outdating is skipped for self-changed ${Hints.rev(cause.revision, cause.member)}`)

        // Variant 2:
        // const hint = this.hint()
        // const causeHint = Hints.revision(cause.revision, cause.member)
        // throw misuse(`reaction ${hint} should either read or write ${causeHint}, but not both (consider using untracked read)`)
      }
    }
  }

  ensureUpToDate(now: boolean, nothrow: boolean): void {
    const t = this.options.throttling
    const interval = Date.now() + this.started // "started" is stored as negative value after reaction completion
    const hold = t ? t - interval : 0 // "started" is stored as negative value after reaction completion
    if (now || hold < 0) {
      if (!this.error && (this.options.kind === Kind.Operation ||
        !this.successor || this.successor.transaction.isCanceled)) {
        try {
          const op: Operation = this.controller.invoke(false, undefined)
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
        setTimeout(() => this.ensureUpToDate(true, true), hold)
      else
        this.addToAsyncReactionsBatch()
    }
  }

  reenterOver(head: Operation): this {
    let error: Error | undefined = undefined
    const concurrent = head.successor
    if (concurrent && !concurrent.transaction.isFinished) {
      if (Dbg.isOn && Dbg.trace.obsolete)
        Dbg.log('║', ' [!]', `${this.hint()} is trying to re-enter over ${concurrent.hint()}`)
      switch (head.options.reentrance) {
        case Reentrance.PreventWithError:
          if (!concurrent.transaction.isCanceled)
            throw misuse(`${head.hint()} (${head.why()}) is not reentrant over ${concurrent.hint()} (${concurrent.why()})`)
          error = new Error(`T${this.transaction.id}[${this.transaction.hint}] is on hold/PreventWithError due to canceled T${concurrent.transaction.id}[${concurrent.transaction.hint}]`)
          this.transaction.cancel(error, concurrent.transaction)
          break
        case Reentrance.WaitAndRestart:
          error = new Error(`T${this.transaction.id}[${this.transaction.hint}] is on hold/WaitAndRestart due to active T${concurrent.transaction.id}[${concurrent.transaction.hint}]`)
          this.transaction.cancel(error, concurrent.transaction)
          break
        case Reentrance.CancelAndWaitPrevious:
          error = new Error(`T${this.transaction.id}[${this.transaction.hint}] is on hold/CancelAndWaitPrevious due to active T${concurrent.transaction.id}[${concurrent.transaction.hint}]`)
          this.transaction.cancel(error, concurrent.transaction)
          concurrent.transaction.cancel(new Error(`T${concurrent.transaction.id}[${concurrent.transaction.hint}] is canceled due to re-entering T${this.transaction.id}[${this.transaction.hint}]`), null)
          break
        case Reentrance.CancelPrevious:
          concurrent.transaction.cancel(new Error(`T${concurrent.transaction.id}[${concurrent.transaction.hint}] is canceled due to re-entering T${this.transaction.id}[${this.transaction.hint}]`), null)
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
      op.result = op.options.body.call(proxy, ...op.args)
    }
    finally {
      op.leaveOrAsync()
    }
  }

  private enter(): void {
    if (this.options.monitor)
      this.monitorEnter(this.options.monitor)
    if (Dbg.isOn && Dbg.trace.method)
      Dbg.log('║', '‾\\', `${this.hint()} - enter`, undefined, `    [ ${Hints.obj(this.controller.ownHolder, this.controller.memberName)} ]`)
    this.started = Date.now()
  }

  private leaveOrAsync(): void {
    if (this.result instanceof Promise) {
      this.result = this.result.then(
        value => {
          this.value = value
          this.leave(false, '  □ ', '- finished ', ' OK ──┘')
          return value
        },
        error => {
          this.error = error
          this.leave(false, '  □ ', '- finished ', 'ERR ──┘')
          throw error
        })
      if (Dbg.isOn) {
        if (Dbg.trace.method)
          Dbg.log('║', '_/', `${this.hint()} - leave... `, 0, 'ASYNC ──┐')
        else if (Dbg.trace.transaction)
          Dbg.log('║', '  ', `${this.hint()}... `, 0, 'ASYNC')
      }
    }
    else {
      this.value = this.result
      this.leave(true, '_/', '- leave')
    }
  }

  private leave(main: boolean, op: string, message: string, highlight: string | undefined = undefined): void {
    const ms: number = Date.now() - this.started
    this.started = -this.started
    if (Dbg.isOn && Dbg.trace.method)
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
      spawn: true,
      trace: Dbg.isOn && Dbg.trace.monitor ? undefined : Dbg.global,
    }
    ControllerImpl.runWithin<void>(undefined, Transaction.runAs, options,
      MonitorImpl.enter, mon, this.transaction)
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.isolated<void>(() => {
      const leave = (): void => {
        const options: SnapshotOptions = {
          hint: 'Monitor.leave',
          spawn: true,
          trace: Dbg.isOn && Dbg.trace.monitor ? undefined : Dbg.DefaultLevel,
        }
        ControllerImpl.runWithin<void>(undefined, Transaction.runAs, options,
          MonitorImpl.leave, mon, this.transaction)
      }
      this.transaction.whenFinished().then(leave, leave)
    })
  }

  private addToAsyncReactionsBatch(): void {
    Operation.asyncReactionsBatch.push(this)
    if (Operation.asyncReactionsBatch.length === 1)
      setTimeout(Operation.processAsyncReactionsBatch, 0)
  }

  private static processAsyncReactionsBatch(): void {
    const reactions = Operation.asyncReactionsBatch
    Operation.asyncReactionsBatch = [] // reset
    for (const t of reactions)
      t.ensureUpToDate(true, true)
  }

  private static markUsed(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, kind: Kind, weak: boolean): void {
    if (kind !== Kind.Operation) {
      const op: Operation | undefined = Operation.current // alias
      if (op && op.options.kind !== Kind.Operation && m !== Meta.Holder) {
        const ctx = Snapshot.current()
        if (ctx !== r.snapshot) // snapshot should not bump itself
          ctx.bumpBy(r.snapshot.timestamp)
        const t = weak ? -1 : ctx.timestamp
        if (!op.subscribeTo(observable, r, m, h, t))
          op.markObsoleteDueTo(observable, { revision: r, member: m, times: 0 }, ctx.timestamp, ctx.reactions)
      }
    }
  }

  private static markEdited(value: any, edited: boolean, r: ObjectRevision, m: MemberName, h: ObjectHolder): void {
    edited ? r.members.add(m) : r.members.delete(m)
    if (Dbg.isOn && Dbg.trace.write)
      edited ? Dbg.log('║', '  ♦', `${Hints.rev(r, m)} = ${valueHint(value)}`) : Dbg.log('║', '  ♦', `${Hints.rev(r, m)} = ${valueHint(value)}`, undefined, ' (same as previous)')
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof Operation && oldValue.obsoleteSince !== INIT_TIMESTAMP
    return result
  }

  private static propagateChanges(snapshot: Snapshot, error: Error | undefined): void {
    const since = snapshot.timestamp
    if (!error) {
      const reactions = snapshot.reactions
      snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
        if (!r.members.has(Meta.Disposed))
          r.members.forEach(m => Operation.propagateMemberChangeToReactions(false, since, r, m, h, reactions))
        else
          for (const m in r.prev.revision.data)
            Operation.propagateMemberChangeToReactions(true, since, r, m, h, reactions)
      })
      reactions.sort(compareReactionsByPriority)
      snapshot.options.journal?.remember(
        TransactionJournalImpl.createPatch(snapshot.hint, snapshot.changeset))
    }
    else
      snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) =>
        r.members.forEach(m => Operation.propagateMemberChangeToReactions(true, since, r, m, h, undefined)))
  }

  private static propagateMemberChangeToReactions(unsubscribe: boolean, timestamp: number,
    r: ObjectRevision, m: MemberName, h: ObjectHolder, reactions?: Observer[]): void {
    if (reactions) {
      // Propagate change to reactions
      const prev = r.prev.revision.data[m]
      if (prev !== undefined && prev instanceof Observable) {
        const cause: MemberInfo = { revision: r, member: m, times: 0 }
        if (prev instanceof Operation && (prev.obsoleteSince === MAX_TIMESTAMP || prev.obsoleteSince <= 0)) {
          prev.obsoleteDueTo = cause
          prev.obsoleteSince = timestamp
          prev.unsubscribeFromAll()
        }
        if (prev.observers)
          prev.observers.forEach(c => c.markObsoleteDueTo(prev, cause, timestamp, reactions))
      }
    }
    const curr = r.data[m]
    if (curr instanceof Operation) {
      if (curr.revision === r) {
        if (unsubscribe)
          curr.unsubscribeFromAll()
        // Clear recomputing status of previous cached result
        // const prev = cache.revision.prev.revision.data[m]
        // if (prev instanceof CallResult && prev.revalidation === cache)
        //   prev.revalidation = undefined
        // Performance tracking
        if (Hooks.repetitiveReadWarningThreshold < Number.MAX_SAFE_INTEGER) {
          curr.observables.forEach((hint, v) => {
            if (hint.times > Hooks.repetitiveReadWarningThreshold)
              Dbg.log('', '[!]', `${curr.hint()} uses ${Hints.rev(hint.revision, hint.member)} ${hint.times} times (consider remembering it in a local variable)`, 0, ' *** WARNING ***')
          })
        }
      }
    }
    else if (curr instanceof Observable && curr.observers) {
      // Unsubscribe from self-changed observables
      curr.observers.forEach(o => {
        o.observables.delete(curr)
        if (Dbg.isOn && Dbg.trace.read)
          Dbg.log(Dbg.trace.transaction && !Snapshot.current().sealed ? '║' : ' ', '-', `${o.hint()} is unsubscribed from self-changed ${Hints.rev(r, m)}`)
      })
      curr.observers = undefined
    }
  }

  private unsubscribeFromAll(): void {
    // It's critical to have no exceptions here
    this.observables.forEach((hint, value) => {
      const observers = value.observers
      if (observers)
        observers.delete(this)
      if (Dbg.isOn && (Dbg.trace.read || this.options.trace?.read))
        Dbg.log(Dbg.trace.transaction && !Snapshot.current().sealed ? '║' : ' ', '-', `${this.hint()} is unsubscribed from ${Hints.rev(hint.revision, hint.member)}`)
    })
    this.observables.clear()
  }

  private subscribeTo(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, timestamp: number): boolean {
    const isValid = Operation.isValid(observable, r, m, h, timestamp)
    if (isValid) {
      // Performance tracking
      let times: number = 0
      if (Hooks.repetitiveReadWarningThreshold < Number.MAX_SAFE_INTEGER) {
        const existing = this.observables.get(observable)
        times = existing ? existing.times + 1 : 1
      }
      // Acquire observers
      if (!observable.observers)
        observable.observers = new Set<Operation>()
      // Two-way linking
      const info: MemberInfo = { revision: r, member: m, times }
      observable.observers.add(this)
      this.observables.set(observable, info)
      if (Dbg.isOn && (Dbg.trace.read || this.options.trace?.read))
        Dbg.log('║', '  ∞ ', `${this.hint()} is subscribed to ${Hints.rev(r, m)}${info.times > 1 ? ` (${info.times} times)` : ''}`)
    }
    else {
      if (Dbg.isOn && (Dbg.trace.read || this.options.trace?.read))
        Dbg.log('║', '  x ', `${this.hint()} is NOT subscribed to already obsolete ${Hints.rev(r, m)}`)
    }
    return isValid // || observable.next === r
  }

  private static isValid(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, timestamp: number): boolean {
    let result = !r.snapshot.sealed || observable === h.head.data[m]
    if (result && timestamp !== INIT_TIMESTAMP)
      result = !(observable instanceof Operation && timestamp >= observable.obsoleteSince)
    return result
  }

  private static createMethodTrap(h: ObjectHolder, m: MemberName, options: OptionsImpl): F<any> {
    const opCtl = new ControllerImpl(h, m)
    const methodTrap: F<any> = (...args: any[]): any =>
      opCtl.invoke(false, args).result
    Meta.set(methodTrap, Meta.Method, opCtl)
    return methodTrap
  }

  private static applyMethodOptions(proto: any, m: MemberName, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<MethodOptions>, implicit: boolean): OptionsImpl {
    // Configure options
    const blank: any = Meta.acquire(proto, Meta.Blank)
    const existing: Operation | undefined = blank[m]
    const ctl = existing ? existing.controller : new ControllerImpl(NIL_HOLDER, m)
    const opts = existing ? existing.options : OptionsImpl.INITIAL
    const op =  new Operation(ctl, NIL_REV, new OptionsImpl(body, opts, options, implicit))
    blank[m] = op
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
    Dbg.getMergedTraceOptions = getMergedTraceOptions
    Snapshot.markUsed = Operation.markUsed // override
    Snapshot.markEdited = Operation.markEdited // override
    Snapshot.isConflicting = Operation.isConflicting // override
    Snapshot.propagateChanges = Operation.propagateChanges // override
    Hooks.createMethodTrap = Operation.createMethodTrap // override
    Hooks.applyMethodOptions = Operation.applyMethodOptions // override
    Promise.prototype.then = reactronicHookedThen // override
    try {
      Object.defineProperty(globalThis, 'rWhy', {
        get: ControllerImpl.why, configurable: false, enumerable: false,
      })
      Object.defineProperty(globalThis, 'rBriefWhy', {
        get: ControllerImpl.briefWhy, configurable: false, enumerable: false,
      })
    }
    catch (e) {
      // ignore
    }
    try {
      Object.defineProperty(global, 'rWhy', {
        get: ControllerImpl.why, configurable: false, enumerable: false,
      })
      Object.defineProperty(global, 'rBriefWhy', {
        get: ControllerImpl.briefWhy, configurable: false, enumerable: false,
      })
    }
    catch (e) {
      // ignore
    }
  }
}

function propagationHint(cause: MemberInfo, full: boolean): string[] {
  const result: string[] = []
  let observable: Observable = cause.revision.data[cause.member]
  while (observable instanceof Operation && observable.obsoleteDueTo) {
    full && result.push(Hints.rev(cause.revision, cause.member))
    cause = observable.obsoleteDueTo
    observable = cause.revision.data[cause.member]
  }
  result.push(Hints.rev(cause.revision, cause.member))
  full && result.push(cause.revision.snapshot.hint)
  return result
}

function valueHint(value: any): string {
  let result: string = ''
  if (Array.isArray(value))
    result = `Array(${value.length})`
  else if (value instanceof Set)
    result = `Set(${value.size})`
  else if (value instanceof Map)
    result = `Map(${value.size})`
  else if (value instanceof Operation)
    result = `<rerun:${Hints.rev(value.revision.prev.revision)}>`
  else if (value === Meta.Disposed)
    result = '<disposed>'
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 20)
  else
    result = '◌'
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
      resolve = op.bind(resolve)
      reject = op.bind(reject)
    }
    resolve = tran.bind(resolve, false)
    reject = tran.bind(reject, true)
  }
  return ORIGINAL_PROMISE_THEN.call(this, resolve, reject)
}

function compareReactionsByPriority(a: Observer, b: Observer): number {
  return a.priority - b.priority
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
