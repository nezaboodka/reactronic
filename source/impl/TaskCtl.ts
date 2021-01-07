// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
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

type TaskContext = { task: Task, isValid: boolean, snapshot: Snapshot, revision: ObjectRevision }

export class TaskCtl extends Controller<any> {
  readonly ownHolder: ObjectHolder
  readonly memberName: MemberName

  configure(options: Partial<MethodOptions>): MethodOptions { return TaskCtl.configureImpl(this, options) }
  get options(): MethodOptions { return this.current(undefined).task.options }
  get unobservable(): any { return this.current(undefined).task.value }
  get args(): ReadonlyArray<any> { return this.weak().task.args }
  get result(): any { return this.call(true, undefined).value }
  get error(): boolean { return this.weak().task.error }
  get stamp(): number { return this.weak().revision.snapshot.timestamp }
  get isValid(): boolean { return this.weak().isValid }
  invalidate(): void { Transaction.runAs({ hint: Dbg.isOn ? `invalidate(${Hints.obj(this.ownHolder, this.memberName)})` : 'invalidate()' }, TaskCtl.invalidate, this) }
  getLastResultAndRevalidate(args?: any[]): any { return this.call(true, args).value }

  constructor(ownHolder: ObjectHolder, memberName: MemberName) {
    super()
    this.ownHolder = ownHolder
    this.memberName = memberName
  }

  call(weak: boolean, args: any[] | undefined): Task {
    let tc: TaskContext = this.current(args)
    const ctx = tc.snapshot
    const task: Task = tc.task
    if (!tc.isValid && tc.revision.data[Meta.Disposed] === undefined
      && (!weak || task.invalidatedSince === INIT_TIMESTAMP || !task.subsequent || task.subsequent.worker.isFinished)) {
      const opt = task.options
      const spawn = weak || opt.kind === Kind.Reaction ||
        (opt.kind === Kind.Cache && (tc.revision.snapshot.sealed || tc.revision.prev.revision !== NIL_REV))
      const token = opt.noSideEffects ? this : undefined
      const call2 = this.run(tc, spawn, opt, token, args)
      const ctx2 = call2.task.revision.snapshot
      if (!weak || ctx === ctx2 || (ctx2.sealed && ctx.timestamp >= ctx2.timestamp))
        tc = call2
    }
    else if (Dbg.isOn && Dbg.trace.methods && (task.options.trace === undefined || task.options.trace.methods === undefined || task.options.trace.methods === true))
      Dbg.log(Transaction.current.isFinished ? '' : '║', ' (=)', `${Hints.rev(tc.revision, this.memberName)} result is reused from T${tc.task.worker.id}[${tc.task.worker.hint}]`)
    const t = tc.task
    Snapshot.markViewed(t, tc.revision, this.memberName, this.ownHolder, t.options.kind, weak)
    return t
  }

  static of(method: F<any>): Controller<any> {
    const ctl = Meta.get<Controller<any> | undefined>(method, Meta.Method)
    if (!ctl)
      throw misuse(`given method is not decorated as reactronic one: ${method.name}`)
    return ctl
  }

  static configureImpl(self: TaskCtl | undefined, options: Partial<MethodOptions>): MethodOptions {
    let task: Task | undefined
    if (self)
      task = self.edit().task
    else
      task = Task.current
    if (!task || task.worker.isFinished)
      throw misuse('a method is expected with reactronic decorator')
    task.options = new OptionsImpl(task.options.body, task.options, options, false)
    if (Dbg.isOn && Dbg.trace.writes)
      Dbg.log('║', '  ♦', `${task.hint()}.options = ...`)
    return task.options
  }

  static run<T>(task: Task | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined
    const outer = Task.current
    try {
      Task.current = task
      result = func(...args)
    }
    catch (e) {
      if (task)
        task.error = e
      throw e
    }
    finally {
      Task.current = outer
    }
    return result
  }

  static whyFull(): string {
    const task = Task.current
    return task ? task.whyFull() : NIL_HOLDER.hint
  }

  static whyShort(): string {
    const task = Task.current
    return task ? task.whyShort() : NIL_HOLDER.hint
  }

  /* istanbul ignore next */
  static deps(): string[] {
    const task = Task.current
    return task ? task.deps() : ['Reactronic.deps should be called from inside of reactive method']
  }

  // Internal

  private weak(): TaskContext {
    const call = this.current(undefined)
    Snapshot.markViewed(call.task, call.revision,
      this.memberName, this.ownHolder, call.task.options.kind, true)
    return call
  }

  private current(args: any[] | undefined): TaskContext {
    const ctx = Snapshot.current()
    const r: ObjectRevision = ctx.findRevOf(this.ownHolder, this.memberName)
    const task: Task = this.from(r)
    const isValid = task.options.kind !== Kind.Transaction && task.invalidatedSince !== INIT_TIMESTAMP &&
      (ctx === task.revision.snapshot || ctx.timestamp < task.invalidatedSince) &&
      (!task.options.sensitiveArgs || args === undefined || task.args.length === args.length && task.args.every((t, i) => t === args[i])) ||
      r.data[Meta.Disposed] !== undefined
    return { task, isValid, snapshot: ctx, revision: r }
  }

  private edit(): TaskContext {
    const ctx = Snapshot.edit()
    const h = this.ownHolder
    const m = this.memberName
    const r: ObjectRevision = ctx.getEditableRevision(h, m, Meta.Holder, this)
    let task: Task = this.from(r)
    if (task.revision !== r) {
      const task2 = new Task(this, r, task)
      task = r.data[m] = task2.reenterOver(task)
      ctx.bumpBy(r.prev.revision.snapshot.timestamp)
      Snapshot.markEdited(task, true, r, m, h)
    }
    return { task, isValid: true, snapshot: ctx, revision: r }
  }

  private from(r: ObjectRevision): Task {
    const m = this.memberName
    let task: Task = r.data[m]
    if (task.controller !== this) {
      const hint: string = Dbg.isOn ? `${Hints.obj(this.ownHolder, m)}/init` : /* istanbul ignore next */ 'MethodController/init'
      const spawn = r.snapshot.sealed || r.prev.revision !== NIL_REV
      task = Transaction.runAs<Task>({ hint, spawn, token: this }, (): Task => {
        const h = this.ownHolder
        let r2: ObjectRevision = Snapshot.current().getCurrentRevision(h, m)
        let task2 = r2.data[m] as Task
        if (task2.controller !== this) {
          r2 = Snapshot.edit().getEditableRevision(h, m, Meta.Holder, this)
          task2 = r2.data[m] = new Task(this, r2, task2)
          task2.invalidatedSince = INIT_TIMESTAMP // indicates blank value
          Snapshot.markEdited(task2, true, r2, m, h)
        }
        return task2
      })
    }
    return task
  }

  private run(existing: TaskContext, spawn: boolean, options: MethodOptions, token: any, args: any[] | undefined): TaskContext {
    // TODO: Cleaner implementation is needed
    const hint: string = Dbg.isOn ? `${Hints.obj(this.ownHolder, this.memberName)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? ` - ${args[0]}` : ''}` : /* istanbul ignore next */ `${Hints.obj(this.ownHolder, this.memberName)}`
    let call = existing
    const opt = { hint, spawn, journal: options.journal, trace: options.trace, token }
    const result = Transaction.runAs(opt, (argsx: any[] | undefined): any => {
      if (!call.task.worker.isCanceled) { // first call
        call = this.edit()
        if (Dbg.isOn && (Dbg.trace.transactions || Dbg.trace.methods || Dbg.trace.invalidations))
          Dbg.log('║', ' (f)', `${call.task.whyFull()}`)
        call.task.run(this.ownHolder.proxy, argsx)
      }
      else { // retry call
        call = this.current(argsx) // re-read on retry
        if (call.task.options.kind === Kind.Transaction || !call.isValid) {
          call = this.edit()
          if (Dbg.isOn && (Dbg.trace.transactions || Dbg.trace.methods || Dbg.trace.invalidations))
            Dbg.log('║', ' (f)', `${call.task.whyFull()}`)
          call.task.run(this.ownHolder.proxy, argsx)
        }
      }
      return call.task.result
    }, args)
    call.task.result = result
    return call
  }

  private static invalidate(self: TaskCtl): void {
    const tc = self.current(undefined)
    const ctx = tc.snapshot
    const task: Task = tc.task
    task.invalidateDueTo(task, {revision: NIL_REV, member: self.memberName, views: 0}, ctx.timestamp, ctx.reactions)
  }
}

// Task

class Task extends Observable implements Observer {
  static current?: Task = undefined
  static asyncReactionsBatch: Task[] = []

  readonly margin: number
  readonly worker: Worker
  readonly controller: TaskCtl
  readonly revision: ObjectRevision
  readonly observables: Map<Observable, MemberInfo>
  options: OptionsImpl
  cause: MemberInfo | undefined
  args: any[]
  result: any
  error: any
  started: number
  invalidatedDueTo: MemberInfo | undefined
  invalidatedSince: number
  subsequent: Task | undefined

  constructor(controller: TaskCtl, revision: ObjectRevision, prev: Task | OptionsImpl) {
    super(undefined)
    this.margin = Task.current ? Task.current.margin + 1 : 1
    this.worker = Transaction.current
    this.controller = controller
    this.revision = revision
    this.observables = new Map<Observable, MemberInfo>()
    if (prev instanceof Task) {
      this.options = prev.options
      this.args = prev.args
      // this.value = init.value
      this.cause = prev.invalidatedDueTo
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
    this.invalidatedSince = 0
    this.invalidatedDueTo = undefined
    this.subsequent = undefined
  }

  get isTask(): boolean { return true } // override
  hint(): string { return `${Hints.rev(this.revision, this.controller.memberName)}` } // override
  get priority(): number { return this.options.priority }

  whyFull(): string {
    let ms: number = Date.now()
    const prev = this.revision.prev.revision.data[this.controller.memberName]
    if (prev instanceof Task)
      ms = Math.abs(this.started) - Math.abs(prev.started)
    let cause: string
    if (this.cause)
      cause = `   <<   ${propagationHint(this.cause, true).join('   <<   ')}`
    else if (this.controller.options.kind === Kind.Transaction)
      cause = '   <<   transaction'
    else
      cause = `   <<   called within ${this.revision.snapshot.hint}`
    return `${this.hint()}${cause}   (${ms}ms since previous revalidation)`
  }

  whyShort(): string {
    return this.cause ? propagationHint(this.cause, false)[0] : NIL_HOLDER.hint
  }

  deps(): string[] {
    throw misuse('not implemented yet')
  }

  bind<T>(func: F<T>): F<T> {
    const boundFunc: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.steps && this.result)
        Dbg.logAs({margin2: this.margin}, '║', '‾\\', `${this.hint()} - step in  `, 0, '        │')
      const started = Date.now()
      const result = TaskCtl.run<T>(this, func, ...args)
      const ms = Date.now() - started
      if (Dbg.isOn && Dbg.trace.steps && this.result)
        Dbg.logAs({margin2: this.margin}, '║', '_/', `${this.hint()} - step out `, 0, this.started > 0 ? '        │' : '')
      if (ms > Hooks.mainThreadBlockingWarningThreshold) /* istanbul ignore next */
        Dbg.log('', '[!]', this.whyFull(), ms, '    *** main thread is too busy ***')
      return result
    }
    return boundFunc
  }

  run(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.invalidatedSince = MAX_TIMESTAMP
    if (!this.error)
      TaskCtl.run<void>(this, Task.run, this, proxy)
    else
      this.result = Promise.reject(this.error)
  }

  invalidateDueTo(observable: Observable, cause: MemberInfo, since: number, reactions: Observer[]): void {
    if (this.invalidatedSince === MAX_TIMESTAMP || this.invalidatedSince <= 0) {
      const skip = !observable.isTask &&
        cause.revision.snapshot === this.revision.snapshot &&
        cause.revision.members.has(cause.member)
      if (!skip) {
        this.invalidatedDueTo = cause
        this.invalidatedSince = since
        const isReaction = this.options.kind === Kind.Reaction /*&& this.revision.data[Meta.Disposed] === undefined*/
        if (Dbg.isOn && (Dbg.trace.invalidations || this.options.trace?.invalidations))
          Dbg.log(Dbg.trace.transactions && !Snapshot.current().sealed ? '║' : ' ', isReaction ? '█' : '▒', isReaction && cause.revision === NIL_REV ? `${this.hint()} is a reaction and will run automatically (priority ${this.options.priority})` : `${this.hint()} is invalidated due to ${Hints.rev(cause.revision, cause.member)} since v${since}${isReaction ? ` and will run automatically (priority ${this.options.priority})` : ''}`)
        this.unsubscribeFromAll()
        if (isReaction) // stop cascade invalidation on reaction
          reactions.push(this)
        else if (this.observers) // cascade invalidation
          this.observers.forEach(c => c.invalidateDueTo(this, {revision: this.revision, member: this.controller.memberName, views: 0}, since, reactions))
        const worker = this.worker
        if (!worker.isFinished && this !== observable) // restart after itself if canceled
          worker.cancel(new Error(`T${worker.id}[${worker.hint}] is canceled due to invalidation by ${Hints.rev(cause.revision, cause.member)}`), null)
      }
      else {
        if (Dbg.isOn && (Dbg.trace.invalidations || this.options.trace?.invalidations))
          Dbg.log(' ', 'x', `${this.hint()} invalidation is skipped for self-changed ${Hints.rev(cause.revision, cause.member)}`)

        // Variant 2:
        // const hint = this.hint()
        // const causeHint = Hints.revision(cause.revision, cause.member)
        // throw misuse(`reaction ${hint} should either read or write ${causeHint}, but not both (consider using untracked read)`)
      }
    }
  }

  revalidate(now: boolean, nothrow: boolean): void {
    const t = this.options.throttling
    const interval = Date.now() + this.started // "started" is stored as negative value after reaction completion
    const hold = t ? t - interval : 0 // "started" is stored as negative value after reaction completion
    if (now || hold < 0) {
      if (!this.error && (this.options.kind === Kind.Transaction ||
        !this.subsequent || this.subsequent.worker.isCanceled)) {
        try {
          const task: Task = this.controller.call(false, undefined)
          if (task.result instanceof Promise)
            task.result.catch(error => {
              if (task.options.kind === Kind.Reaction)
                misuse(`reaction ${task.hint()} failed and will not run anymore: ${error}`, error)
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
        setTimeout(() => this.revalidate(true, true), hold)
      else
        this.addToAsyncReactionsBatch()
    }
  }

  reenterOver(head: Task): this {
    let error: Error | undefined = undefined
    const concurrent = head.subsequent
    if (concurrent && !concurrent.worker.isFinished) {
      if (Dbg.isOn && Dbg.trace.invalidations)
        Dbg.log('║', ' [!]', `${this.hint()} is trying to re-enter over ${concurrent.hint()}`)
      switch (head.options.reentrance) {
        case Reentrance.PreventWithError:
          if (!concurrent.worker.isCanceled)
            throw misuse(`${head.hint()} (${head.whyFull()}) is not reentrant over ${concurrent.hint()} (${concurrent.whyFull()})`)
          error = new Error(`T${this.worker.id}[${this.worker.hint}] is on hold/PreventWithError due to canceled T${concurrent.worker.id}[${concurrent.worker.hint}]`)
          this.worker.cancel(error, concurrent.worker)
          break
        case Reentrance.WaitAndRestart:
          error = new Error(`T${this.worker.id}[${this.worker.hint}] is on hold/WaitAndRestart due to active T${concurrent.worker.id}[${concurrent.worker.hint}]`)
          this.worker.cancel(error, concurrent.worker)
          break
        case Reentrance.CancelAndWaitPrevious:
          error = new Error(`T${this.worker.id}[${this.worker.hint}] is on hold/CancelAndWaitPrevious due to active T${concurrent.worker.id}[${concurrent.worker.hint}]`)
          this.worker.cancel(error, concurrent.worker)
          concurrent.worker.cancel(new Error(`T${concurrent.worker.id}[${concurrent.worker.hint}] is canceled due to re-entering T${this.worker.id}[${this.worker.hint}]`), null)
          break
        case Reentrance.CancelPrevious:
          concurrent.worker.cancel(new Error(`T${concurrent.worker.id}[${concurrent.worker.hint}] is canceled due to re-entering T${this.worker.id}[${this.worker.hint}]`), null)
          break
        case Reentrance.RunSideBySide:
          break // do nothing
      }
    }
    if (!error)
      head.subsequent = this
    else
      this.error = error
    return this
  }

  // Internal

  private static run(task: Task, proxy: any): void {
    task.enter()
    try {
      task.result = task.options.body.call(proxy, ...task.args)
    }
    finally {
      task.leaveOrAsync()
    }
  }

  private enter(): void {
    if (this.options.monitor)
      this.monitorEnter(this.options.monitor)
    if (Dbg.isOn && Dbg.trace.methods)
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
        if (Dbg.trace.methods)
          Dbg.log('║', '_/', `${this.hint()} - leave... `, 0, 'ASYNC ──┐')
        else if (Dbg.trace.transactions)
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
    if (Dbg.isOn && Dbg.trace.methods)
      Dbg.log('║', `${op}`, `${this.hint()} ${message}`, ms, highlight)
    if (ms > (main ? Hooks.mainThreadBlockingWarningThreshold : Hooks.asyncActionDurationWarningThreshold)) /* istanbul ignore next */
      Dbg.log('', '[!]', this.whyFull(), ms, main ? '    *** main thread is too busy ***' : '    *** async is too long ***')
    if (this.options.monitor)
      this.monitorLeave(this.options.monitor)
    // CachedResult.freeze(this)
  }

  private monitorEnter(mon: Monitor): void {
    const options: SnapshotOptions = {
      hint: 'Monitor.enter',
      spawn: true,
      trace: Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global,
    }
    TaskCtl.run<void>(undefined, Transaction.runAs, options,
      MonitorImpl.enter, mon, this.worker)
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.isolated<void>(() => {
      const leave = (): void => {
        const options: SnapshotOptions = {
          hint: 'Monitor.leave',
          spawn: true,
          trace: Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.DefaultLevel,
        }
        TaskCtl.run<void>(undefined, Transaction.runAs, options,
          MonitorImpl.leave, mon, this.worker)
      }
      this.worker.whenFinished().then(leave, leave)
    })
  }

  private addToAsyncReactionsBatch(): void {
    Task.asyncReactionsBatch.push(this)
    if (Task.asyncReactionsBatch.length === 1)
      setTimeout(Task.processAsyncReactionsBatch, 0)
  }

  private static processAsyncReactionsBatch(): void {
    const reactions = Task.asyncReactionsBatch
    Task.asyncReactionsBatch = [] // reset
    for (const t of reactions)
      t.revalidate(true, true)
  }

  private static markViewed(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, kind: Kind, weak: boolean): void {
    if (kind !== Kind.Transaction) {
      const task: Task | undefined = Task.current // alias
      if (task && task.options.kind !== Kind.Transaction && m !== Meta.Holder) {
        const ctx = Snapshot.current()
        if (ctx !== r.snapshot) // snapshot should not bump itself
          ctx.bumpBy(r.snapshot.timestamp)
        const t = weak ? -1 : ctx.timestamp
        if (!task.subscribeTo(observable, r, m, h, t))
          task.invalidateDueTo(observable, { revision: r, member: m, views: 0 }, ctx.timestamp, ctx.reactions)
      }
    }
  }

  private static markEdited(value: any, edited: boolean, r: ObjectRevision, m: MemberName, h: ObjectHolder): void {
    edited ? r.members.add(m) : r.members.delete(m)
    if (Dbg.isOn && Dbg.trace.writes)
      edited ? Dbg.log('║', '  ♦', `${Hints.rev(r, m)} = ${valueHint(value)}`) : Dbg.log('║', '  ♦', `${Hints.rev(r, m)} = ${valueHint(value)}`, undefined, ' (same as previous)')
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof Task && oldValue.invalidatedSince !== INIT_TIMESTAMP
    return result
  }

  private static propagateChangesToReactions(snapshot: Snapshot, error: Error | undefined): void {
    const since = snapshot.timestamp
    if (!error) {
      const reactions = snapshot.reactions
      snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
        if (!r.members.has(Meta.Disposed))
          r.members.forEach(m => Task.propagateMemberChangeToReactions(false, since, r, m, h, reactions))
        else
          for (const m in r.prev.revision.data)
            Task.propagateMemberChangeToReactions(true, since, r, m, h, reactions)
      })
      reactions.sort(compareReactionsByPriority)
      snapshot.options.journal?.remember(
        TransactionJournalImpl.createPatch(snapshot.hint, snapshot.changeset))
    }
    else
      snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) =>
        r.members.forEach(m => Task.propagateMemberChangeToReactions(true, since, r, m, h, undefined)))
  }

  private static propagateMemberChangeToReactions(unsubscribe: boolean, timestamp: number,
    r: ObjectRevision, m: MemberName, h: ObjectHolder, reactions?: Observer[]): void {
    if (reactions) {
      // Propagate change to reactions
      const prev = r.prev.revision.data[m]
      if (prev !== undefined && prev instanceof Observable) {
        const cause: MemberInfo = { revision: r, member: m, views: 0 }
        if (prev instanceof Task && (prev.invalidatedSince === MAX_TIMESTAMP || prev.invalidatedSince <= 0)) {
          prev.invalidatedDueTo = cause
          prev.invalidatedSince = timestamp
          prev.unsubscribeFromAll()
        }
        if (prev.observers)
          prev.observers.forEach(c => c.invalidateDueTo(prev, cause, timestamp, reactions))
      }
    }
    const curr = r.data[m]
    if (curr instanceof Task) {
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
            if (hint.views > Hooks.repetitiveReadWarningThreshold)
              Dbg.log('', '[!]', `${curr.hint()} uses ${Hints.rev(hint.revision, hint.member)} ${hint.views} times (consider remembering it in a local variable)`, 0, ' *** WARNING ***')
          })
        }
      }
    }
    else if (curr instanceof Observable && curr.observers) {
      // Unsubscribe from self-changed observables
      curr.observers.forEach(o => {
        o.observables.delete(curr)
        if (Dbg.isOn && Dbg.trace.reads)
          Dbg.log(Dbg.trace.transactions && !Snapshot.current().sealed ? '║' : ' ', '-', `${o.hint()} is unsubscribed from self-changed ${Hints.rev(r, m)}`)
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
      if (Dbg.isOn && (Dbg.trace.reads || this.options.trace?.reads))
        Dbg.log(Dbg.trace.transactions && !Snapshot.current().sealed ? '║' : ' ', '-', `${this.hint()} is unsubscribed from ${Hints.rev(hint.revision, hint.member)}`)
    })
    this.observables.clear()
  }

  private subscribeTo(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, timestamp: number): boolean {
    const isValid = Task.isValid(observable, r, m, h, timestamp)
    if (isValid) {
      // Performance tracking
      let views: number = 0
      if (Hooks.repetitiveReadWarningThreshold < Number.MAX_SAFE_INTEGER) {
        const existing = this.observables.get(observable)
        views = existing ? existing.views + 1 : 1
      }
      // Acquire observers
      if (!observable.observers)
        observable.observers = new Set<Task>()
      // Two-way linking
      const info: MemberInfo = { revision: r, member: m, views }
      observable.observers.add(this)
      this.observables.set(observable, info)
      if (Dbg.isOn && (Dbg.trace.reads || this.options.trace?.reads))
        Dbg.log('║', '  ∞ ', `${this.hint()} is subscribed to ${Hints.rev(r, m)}${info.views > 1 ? ` (${info.views} times)` : ''}`)
    }
    else {
      if (Dbg.isOn && (Dbg.trace.reads || this.options.trace?.reads))
        Dbg.log('║', '  x ', `${this.hint()} is NOT subscribed to already invalidated ${Hints.rev(r, m)}`)
    }
    return isValid // || observable.next === r
  }

  private static isValid(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, timestamp: number): boolean {
    let result = !r.snapshot.sealed || observable === h.head.data[m]
    if (result && timestamp !== INIT_TIMESTAMP)
      result = !(observable instanceof Task && timestamp >= observable.invalidatedSince)
    return result
  }

  private static createMethodTrap(h: ObjectHolder, m: MemberName, options: OptionsImpl): F<any> {
    const taskCtl = new TaskCtl(h, m)
    const methodTrap: F<any> = (...args: any[]): any =>
      taskCtl.call(false, args).result
    Meta.set(methodTrap, Meta.Method, taskCtl)
    return methodTrap
  }

  private static applyMethodOptions(proto: any, m: MemberName, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<MethodOptions>, implicit: boolean): OptionsImpl {
    // Configure options
    const blank: any = Meta.acquire(proto, Meta.Blank)
    const existing: Task | undefined = blank[m]
    const ctl = existing ? existing.controller : new TaskCtl(NIL_HOLDER, m)
    const opts = existing ? existing.options : OptionsImpl.INITIAL
    const task =  new Task(ctl, NIL_REV, new OptionsImpl(body, opts, options, implicit))
    blank[m] = task
    // Add to the list if it's a reaction
    if (task.options.kind === Kind.Reaction && task.options.throttling < Number.MAX_SAFE_INTEGER) {
      const reactions = Meta.acquire(proto, Meta.Reactions)
      reactions[m] = task
    }
    else if (task.options.kind === Kind.Reaction && task.options.throttling >= Number.MAX_SAFE_INTEGER) {
      const reactions = Meta.getFrom(proto, Meta.Reactions)
      delete reactions[m]
    }
    return task.options
  }

  // static freeze(c: CachedResult): void {
  //   Utils.freezeMap(c.observables)
  //   Object.freeze(c)
  // }

  static init(): void {
    Dbg.getMergedTraceOptions = getMergedTraceOptions
    Snapshot.markViewed = Task.markViewed // override
    Snapshot.markEdited = Task.markEdited // override
    Snapshot.isConflicting = Task.isConflicting // override
    Snapshot.propagateChangesToReactions = Task.propagateChangesToReactions // override
    Hooks.createMethodTrap = Task.createMethodTrap // override
    Hooks.applyMethodOptions = Task.applyMethodOptions // override
    Promise.prototype.then = reactronicHookedThen // override
    try {
      Object.defineProperty(globalThis, 'rWhy', {
        get: TaskCtl.whyFull, configurable: false, enumerable: false,
      })
      Object.defineProperty(globalThis, 'rWhyShort', {
        get: TaskCtl.whyShort, configurable: false, enumerable: false,
      })
    }
    catch (e) {
      // ignore
    }
    try {
      Object.defineProperty(global, 'rWhy', {
        get: TaskCtl.whyFull, configurable: false, enumerable: false,
      })
      Object.defineProperty(global, 'rWhyShort', {
        get: TaskCtl.whyShort, configurable: false, enumerable: false,
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
  while (observable instanceof Task && observable.invalidatedDueTo) {
    full && result.push(Hints.rev(cause.revision, cause.member))
    cause = observable.invalidatedDueTo
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
  else if (value instanceof Task)
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
  if (Task.current)
    res = Dbg.merge({margin2: Task.current.margin}, undefined, undefined, res)
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
    const task = Task.current
    if (task) {
      resolve = task.bind(resolve)
      reject = task.bind(reject)
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

Task.init()
