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
import { ObjectRevision, MemberName, ObjectHolder, Observable, MemberRef, Observer, Meta } from './Data'
import { Snapshot, Hints, NIL_REV, INIT_TIMESTAMP, MAX_TIMESTAMP } from './Snapshot'
import { Transaction } from './Transaction'
import { Monitor, MonitorImpl } from './Monitor'
import { Hooks, OptionsImpl } from './Hooks'
import { TransactionJournalImpl } from './TransactionJournal'

const NIL_HOLDER = new ObjectHolder(undefined, undefined, Hooks.proxy, NIL_REV, 'N/A')

type Call = { snapshot: Snapshot, revision: ObjectRevision, algorithm: Algorithm, isValid: boolean }

export class MethodController extends Controller<any> {
  readonly ownHolder: ObjectHolder
  readonly memberName: MemberName

  configure(options: Partial<MethodOptions>): MethodOptions { return MethodController.configureImpl(this, options) }
  get options(): MethodOptions { return this.read(undefined).algorithm.options }
  get unobservableValue(): any { return this.read(undefined).algorithm.value }
  get args(): ReadonlyArray<any> { return this.weak().algorithm.args }
  get result(): any { return this.call(true, undefined).value }
  get error(): boolean { return this.weak().algorithm.error }
  get stamp(): number { return this.weak().revision.snapshot.timestamp }
  get isInvalidated(): boolean { return !this.weak().isValid }
  invalidate(): void { Transaction.runAs({ hint: Dbg.isOn ? `invalidate(${Hints.obj(this.ownHolder, this.memberName)})` : 'invalidate()' }, MethodController.invalidate, this) }
  getCachedValueAndRevalidate(args?: any[]): any { return this.call(true, args).value }

  constructor(ownHolder: ObjectHolder, memberName: MemberName) {
    super()
    this.ownHolder = ownHolder
    this.memberName = memberName
  }

  call(weak: boolean, args: any[] | undefined): Algorithm {
    let call: Call = this.read(args)
    const ctx = call.snapshot
    const alg: Algorithm = call.algorithm
    if (!call.isValid && call.revision.data[Meta.Disposed] === undefined
      && (!weak || alg.invalidatedSince === INIT_TIMESTAMP || !alg.replacement || alg.replacement.worker.isFinished)) {
      const opt = alg.options
      const spawn = weak || opt.kind === Kind.Reaction ||
        (opt.kind === Kind.Cache && (call.revision.snapshot.sealed || call.revision.prev.revision !== NIL_REV))
      const token = opt.noSideEffects ? this : undefined
      const call2 = this.execute(call, spawn, opt, token, args)
      const ctx2 = call2.algorithm.revision.snapshot
      if (!weak || ctx === ctx2 || (ctx2.sealed && ctx.timestamp >= ctx2.timestamp))
        call = call2
    }
    else if (Dbg.isOn && Dbg.trace.methods && (alg.options.trace === undefined || alg.options.trace.methods === undefined || alg.options.trace.methods === true))
      Dbg.log(Transaction.current.isFinished ? '' : '║', ' (=)', `${Hints.rev(call.revision, this.memberName)} result is reused from T${call.algorithm.worker.id}[${call.algorithm.worker.hint}]`)
    const a = call.algorithm
    Snapshot.markViewed(a, call.revision, this.memberName, this.ownHolder, a.options.kind, weak)
    return a
  }

  static of(method: F<any>): Controller<any> {
    const func = Meta.get<Controller<any> | undefined>(method, Meta.Method)
    if (!func)
      throw misuse(`given method is not decorated as reactronic one: ${method.name}`)
    return func
  }

  static configureImpl(self: MethodController | undefined, options: Partial<MethodOptions>): MethodOptions {
    let alg: Algorithm | undefined
    if (self)
      alg = self.write().algorithm
    else
      alg = Algorithm.current
    if (!alg || alg.worker.isFinished)
      throw misuse('a method is expected with reactronic decorator')
    alg.options = new OptionsImpl(alg.options.body, alg.options, options, false)
    if (Dbg.isOn && Dbg.trace.writes)
      Dbg.log('║', '  ♦', `${Hints.rev(alg.revision, alg.method.memberName)}.options = ...`)
    return alg.options
  }

  static run<T>(alg: Algorithm | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined
    const outer = Algorithm.current
    try {
      Algorithm.current = alg
      result = func(...args)
    }
    catch (e) {
      if (alg)
        alg.error = e
      throw e
    }
    finally {
      Algorithm.current = outer
    }
    return result
  }

  static whyFull(): string {
    const alg = Algorithm.current
    return alg ? alg.whyFull() : NIL_HOLDER.hint
  }

  static whyShort(): string {
    const alg = Algorithm.current
    return alg ? alg.whyShort() : NIL_HOLDER.hint
  }

  /* istanbul ignore next */
  static deps(): string[] {
    const alg = Algorithm.current
    return alg ? alg.deps() : ['Reactronic.deps should be called from inside of reactive method']
  }

  // Internal

  private weak(): Call {
    const call = this.read(undefined)
    Snapshot.markViewed(call.algorithm, call.revision,
      this.memberName, this.ownHolder, call.algorithm.options.kind, true)
    return call
  }

  private read(args: any[] | undefined): Call {
    const ctx = Snapshot.readable()
    const r: ObjectRevision = ctx.findRevision(this.ownHolder, this.memberName)
    const alg: Algorithm = this.from(r)
    const isValid = alg.options.kind !== Kind.Transaction && alg.invalidatedSince !== INIT_TIMESTAMP &&
      (ctx === alg.revision.snapshot || ctx.timestamp < alg.invalidatedSince) &&
      (!alg.options.sensitiveArgs || args === undefined || alg.args.length === args.length && alg.args.every((t, i) => t === args[i])) ||
      r.data[Meta.Disposed] !== undefined
    return { snapshot: ctx, revision: r, algorithm: alg, isValid }
  }

  private write(): Call {
    const ctx = Snapshot.writable()
    const h = this.ownHolder
    const m = this.memberName
    const r: ObjectRevision = ctx.findWritableRevision(h, m, Meta.Holder, this)
    let alg: Algorithm = this.from(r)
    if (alg.revision !== r) {
      const c2 = new Algorithm(this, r, alg)
      alg = r.data[m] = c2.reenterOver(alg)
      ctx.bumpBy(r.prev.revision.snapshot.timestamp)
      Snapshot.markChanged(alg, true, r, m, h)
    }
    return { snapshot: ctx, revision: r, algorithm: alg, isValid: true }
  }

  private from(r: ObjectRevision): Algorithm {
    const m = this.memberName
    let alg: Algorithm = r.data[m]
    if (alg.method !== this) {
      const hint: string = Dbg.isOn ? `${Hints.obj(this.ownHolder, m)}/init` : /* istanbul ignore next */ 'MethodController/init'
      const spawn = r.snapshot.sealed || r.prev.revision !== NIL_REV
      alg = Transaction.runAs<Algorithm>({ hint, spawn, token: this }, (): Algorithm => {
        const h = this.ownHolder
        let r2: ObjectRevision = Snapshot.readable().findReadableRevision(h, m)
        let alg2 = r2.data[m] as Algorithm
        if (alg2.method !== this) {
          r2 = Snapshot.writable().findWritableRevision(h, m, Meta.Holder, this)
          alg2 = r2.data[m] = new Algorithm(this, r2, alg2)
          alg2.invalidatedSince = INIT_TIMESTAMP // indicates blank value
          Snapshot.markChanged(alg2, true, r2, m, h)
        }
        return alg2
      })
    }
    return alg
  }

  private execute(existing: Call, spawn: boolean, options: MethodOptions, token: any, args: any[] | undefined): Call {
    // TODO: Cleaner implementation is needed
    const hint: string = Dbg.isOn ? `${Hints.obj(this.ownHolder, this.memberName)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? ` - ${args[0]}` : ''}` : /* istanbul ignore next */ `${Hints.obj(this.ownHolder, this.memberName)}`
    let call = existing
    const opt = { hint, spawn, journal: options.journal, trace: options.trace, token }
    const ret = Transaction.runAs(opt, (argsx: any[] | undefined): any => {
      if (!call.algorithm.worker.isCanceled) { // first call
        call = this.write()
        if (Dbg.isOn && (Dbg.trace.transactions || Dbg.trace.methods || Dbg.trace.invalidations))
          Dbg.log('║', ' (f)', `${call.algorithm.whyFull()}`)
        call.algorithm.execute(this.ownHolder.proxy, argsx)
      }
      else { // retry call
        call = this.read(argsx) // re-read on retry
        if (call.algorithm.options.kind === Kind.Transaction || !call.isValid) {
          call = this.write()
          if (Dbg.isOn && (Dbg.trace.transactions || Dbg.trace.methods || Dbg.trace.invalidations))
            Dbg.log('║', ' (f)', `${call.algorithm.whyFull()}`)
          call.algorithm.execute(this.ownHolder.proxy, argsx)
        }
      }
      return call.algorithm.ret
    }, args)
    call.algorithm.ret = ret
    return call
  }

  private static invalidate(self: MethodController): void {
    const ctx = Snapshot.readable()
    const call = self.read(undefined)
    const alg: Algorithm = call.algorithm
    alg.invalidateDueTo(alg, {revision: NIL_REV, member: self.memberName, times: 0}, ctx.timestamp, ctx.reactions)
  }
}

// Algorithm

class Algorithm extends Observable implements Observer {
  static current?: Algorithm = undefined
  static asyncReactionsBatch: Algorithm[] = []

  get isComputation(): boolean { return true } // override

  readonly margin: number
  readonly worker: Worker
  readonly method: MethodController
  readonly revision: ObjectRevision
  readonly observables: Map<Observable, MemberRef>
  options: OptionsImpl
  cause: MemberRef | undefined
  args: any[]
  ret: any
  error: any
  started: number
  invalidatedDueTo: MemberRef | undefined
  invalidatedSince: number
  replacement: Algorithm | undefined

  constructor(method: MethodController, revision: ObjectRevision, prev: Algorithm | OptionsImpl) {
    super(undefined)
    this.margin = Algorithm.current ? Algorithm.current.margin + 1 : 1
    this.worker = Transaction.current
    this.method = method
    this.revision = revision
    this.observables = new Map<Observable, MemberRef>()
    if (prev instanceof Algorithm) {
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
    this.replacement = undefined
  }

  hint(): string { return `${Hints.rev(this.revision, this.method.memberName)}` }
  get priority(): number { return this.options.priority }

  whyFull(): string {
    let ms: number = Date.now()
    const prev = this.revision.prev.revision.data[this.method.memberName]
    if (prev instanceof Algorithm)
      ms = Math.abs(this.started) - Math.abs(prev.started)
    let cause: string
    if (this.cause)
      cause = `   <<   ${propagationHint(this.cause, true).join('   <<   ')}`
    else if (this.method.options.kind === Kind.Transaction)
      cause = '   <<   transaction'
    else
      cause = `   <<   called by ${this.revision.snapshot.hint}`
    return `${Hints.rev(this.revision, this.method.memberName)}${cause}   (${ms}ms since previous revalidation)`
  }

  whyShort(): string {
    return this.cause ? propagationHint(this.cause, false)[0] : NIL_HOLDER.hint
  }

  deps(): string[] {
    throw misuse('not implemented yet')
  }

  bind<T>(func: F<T>): F<T> {
    const cacheBound: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.steps && this.ret)
        Dbg.logAs({margin2: this.margin}, '║', '‾\\', `${Hints.rev(this.revision, this.method.memberName)} - step in  `, 0, '        │')
      const started = Date.now()
      const result = MethodController.run<T>(this, func, ...args)
      const ms = Date.now() - started
      if (Dbg.isOn && Dbg.trace.steps && this.ret)
        Dbg.logAs({margin2: this.margin}, '║', '_/', `${Hints.rev(this.revision, this.method.memberName)} - step out `, 0, this.started > 0 ? '        │' : '')
      if (ms > Hooks.mainThreadBlockingWarningThreshold) /* istanbul ignore next */
        Dbg.log('', '[!]', this.whyFull(), ms, '    *** main thread is too busy ***')
      return result
    }
    return cacheBound
  }

  execute(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.invalidatedSince = MAX_TIMESTAMP
    if (!this.error)
      MethodController.run<void>(this, Algorithm.execute, this, proxy)
    else
      this.ret = Promise.reject(this.error)
  }

  invalidateDueTo(observable: Observable, cause: MemberRef, since: number, reactions: Observer[]): void {
    if (this.invalidatedSince === MAX_TIMESTAMP || this.invalidatedSince <= 0) {
      const skip = !observable.isComputation &&
        cause.revision.snapshot === this.revision.snapshot &&
        cause.revision.changes.has(cause.member)
      if (!skip) {
        this.invalidatedDueTo = cause
        this.invalidatedSince = since
        const isReaction = this.options.kind === Kind.Reaction /*&& this.revision.data[Meta.Disposed] === undefined*/
        if (Dbg.isOn && (Dbg.trace.invalidations || this.options.trace?.invalidations))
          Dbg.log(Dbg.trace.transactions && !Snapshot.readable().sealed ? '║' : ' ', isReaction ? '█' : '▒', isReaction && cause.revision === NIL_REV ? `${this.hint()} is a reaction and will run automatically (priority ${this.options.priority})` : `${this.hint()} is invalidated due to ${Hints.rev(cause.revision, cause.member)} since v${since}${isReaction ? ` and will run automatically (priority ${this.options.priority})` : ''}`)
        this.unsubscribeFromAll()
        if (isReaction) // stop cascade invalidation on reaction
          reactions.push(this)
        else if (this.observers) // cascade invalidation
          this.observers.forEach(c => c.invalidateDueTo(this, {revision: this.revision, member: this.method.memberName, times: 0}, since, reactions))
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
        !this.replacement || this.replacement.worker.isCanceled)) {
        try {
          const alg: Algorithm = this.method.call(false, undefined)
          if (alg.ret instanceof Promise)
            alg.ret.catch(error => {
              if (alg.options.kind === Kind.Reaction)
                misuse(`reaction ${Hints.rev(alg.revision, alg.method.memberName)} failed and will not run anymore: ${error}`, error)
            })
        }
        catch (e) {
          if (!nothrow)
            throw e
          else if (this.options.kind === Kind.Reaction)
            misuse(`reaction ${Hints.rev(this.revision, this.method.memberName)} failed and will not run anymore: ${e}`, e)
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

  reenterOver(head: Algorithm): this {
    let error: Error | undefined = undefined
    const concurrent = head.replacement
    if (concurrent && !concurrent.worker.isFinished) {
      if (Dbg.isOn && Dbg.trace.invalidations)
        Dbg.log('║', ' [!]', `${Hints.rev(this.revision, this.method.memberName)} is trying to re-enter over ${Hints.rev(concurrent.revision, concurrent.method.memberName)}`)
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
      head.replacement = this
    else
      this.error = error
    return this
  }

  // Internal

  private static execute(self: Algorithm, proxy: any): void {
    self.enter()
    try {
      self.ret = self.options.body.call(proxy, ...self.args)
    }
    finally {
      self.leaveOrAsync()
    }
  }

  private enter(): void {
    if (this.options.monitor)
      this.monitorEnter(this.options.monitor)
    if (Dbg.isOn && Dbg.trace.methods)
      Dbg.log('║', '‾\\', `${Hints.rev(this.revision, this.method.memberName)} - enter`, undefined, `    [ ${Hints.obj(this.method.ownHolder, this.method.memberName)} ]`)
    this.started = Date.now()
  }

  private leaveOrAsync(): void {
    if (this.ret instanceof Promise) {
      this.ret = this.ret.then(
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
          Dbg.log('║', '_/', `${Hints.rev(this.revision, this.method.memberName)} - leave... `, 0, 'ASYNC ──┐')
        else if (Dbg.trace.transactions)
          Dbg.log('║', '  ', `${Hints.rev(this.revision, this.method.memberName)}... `, 0, 'ASYNC')
      }
    }
    else {
      this.value = this.ret
      this.leave(true, '_/', '- leave')
    }
  }

  private leave(main: boolean, op: string, message: string, highlight: string | undefined = undefined): void {
    const ms: number = Date.now() - this.started
    this.started = -this.started
    if (Dbg.isOn && Dbg.trace.methods)
      Dbg.log('║', `${op}`, `${Hints.rev(this.revision, this.method.memberName)} ${message}`, ms, highlight)
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
    MethodController.run<void>(undefined, Transaction.runAs, options,
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
        MethodController.run<void>(undefined, Transaction.runAs, options,
          MonitorImpl.leave, mon, this.worker)
      }
      this.worker.whenFinished().then(leave, leave)
    })
  }

  private addToAsyncReactionsBatch(): void {
    Algorithm.asyncReactionsBatch.push(this)
    if (Algorithm.asyncReactionsBatch.length === 1)
      setTimeout(Algorithm.processAsyncReactionsBatch, 0)
  }

  private static processAsyncReactionsBatch(): void {
    const reactions = Algorithm.asyncReactionsBatch
    Algorithm.asyncReactionsBatch = [] // reset
    for (const t of reactions)
      t.revalidate(true, true)
  }

  private static markViewed(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, kind: Kind, weak: boolean): void {
    if (kind !== Kind.Transaction) {
      const alg: Algorithm | undefined = Algorithm.current // alias
      if (alg && alg.options.kind !== Kind.Transaction && m !== Meta.Holder) {
        const ctx = Snapshot.readable()
        if (ctx !== r.snapshot) // snapshot should not bump itself
          ctx.bumpBy(r.snapshot.timestamp)
        const t = weak ? -1 : ctx.timestamp
        if (!alg.subscribeTo(observable, r, m, h, t))
          alg.invalidateDueTo(observable, {revision: r, member: m, times: 0}, ctx.timestamp, ctx.reactions)
      }
    }
  }

  private static markChanged(value: any, changed: boolean, r: ObjectRevision, m: MemberName, h: ObjectHolder): void {
    changed ? r.changes.add(m) : r.changes.delete(m)
    if (Dbg.isOn && Dbg.trace.writes)
      changed ? Dbg.log('║', '  ♦', `${Hints.rev(r, m)} = ${valueHint(value)}`) : Dbg.log('║', '  ♦', `${Hints.rev(r, m)} = ${valueHint(value)}`, undefined, ' (same as previous)')
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof Algorithm && oldValue.invalidatedSince !== INIT_TIMESTAMP
    return result
  }

  private static propagateChangesToReactions(snapshot: Snapshot, error: Error | undefined): void {
    const since = snapshot.timestamp
    if (!error) {
      const reactions = snapshot.reactions
      snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
        if (!r.changes.has(Meta.Disposed))
          r.changes.forEach(m => Algorithm.propagateMemberChangeToReactions(false, since, r, m, h, reactions))
        else
          for (const m in r.prev.revision.data)
            Algorithm.propagateMemberChangeToReactions(true, since, r, m, h, reactions)
      })
      reactions.sort(compareReactionsByPriority)
      snapshot.options.journal?.remember(
        TransactionJournalImpl.createPatch(snapshot.hint, snapshot.changeset))
    }
    else
      snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) =>
        r.changes.forEach(m => Algorithm.propagateMemberChangeToReactions(true, since, r, m, h, undefined)))
  }

  private static propagateMemberChangeToReactions(unsubscribe: boolean, timestamp: number,
    r: ObjectRevision, m: MemberName, h: ObjectHolder, reactions?: Observer[]): void {
    if (reactions) {
      // Propagate change to reactions
      const prev = r.prev.revision.data[m]
      if (prev !== undefined && prev instanceof Observable) {
        const cause: MemberRef = { revision: r, member: m, times: 0 }
        if (prev instanceof Algorithm && (prev.invalidatedSince === MAX_TIMESTAMP || prev.invalidatedSince <= 0)) {
          prev.invalidatedDueTo = cause
          prev.invalidatedSince = timestamp
          prev.unsubscribeFromAll()
        }
        if (prev.observers)
          prev.observers.forEach(c => c.invalidateDueTo(prev, cause, timestamp, reactions))
      }
    }
    const curr = r.data[m]
    if (curr instanceof Algorithm) {
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
        if (Dbg.isOn && Dbg.trace.reads)
          Dbg.log(Dbg.trace.transactions && !Snapshot.readable().sealed ? '║' : ' ', '-', `${o.hint()} is unsubscribed from self-changed ${Hints.rev(r, m)}`)
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
        Dbg.log(Dbg.trace.transactions && !Snapshot.readable().sealed ? '║' : ' ', '-', `${Hints.rev(this.revision, this.method.memberName)} is unsubscribed from ${Hints.rev(hint.revision, hint.member)}`)
    })
    this.observables.clear()
  }

  private subscribeTo(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, timestamp: number): boolean {
    const isValid = Algorithm.isValid(observable, r, m, h, timestamp)
    if (isValid) {
      // Performance tracking
      let times: number = 0
      if (Hooks.repetitiveReadWarningThreshold < Number.MAX_SAFE_INTEGER) {
        const existing = this.observables.get(observable)
        times = existing ? existing.times + 1 : 1
      }
      // Acquire observers
      if (!observable.observers)
        observable.observers = new Set<Algorithm>()
      // Two-way linking
      const member: MemberRef = {revision: r, member: m, times}
      observable.observers.add(this)
      this.observables.set(observable, member)
      if (Dbg.isOn && (Dbg.trace.reads || this.options.trace?.reads))
        Dbg.log('║', '  ∞ ', `${Hints.rev(this.revision, this.method.memberName)} is subscribed to ${Hints.rev(r, m)}${member.times > 1 ? ` (${member.times} times)` : ''}`)
    }
    else {
      if (Dbg.isOn && (Dbg.trace.reads || this.options.trace?.reads))
        Dbg.log('║', '  x ', `${Hints.rev(this.revision, this.method.memberName)} is NOT subscribed to already invalidated ${Hints.rev(r, m)}`)
    }
    return isValid // || observable.next === r
  }

  private static isValid(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, timestamp: number): boolean {
    let result = !r.snapshot.sealed || observable === h.head.data[m]
    if (result && timestamp !== INIT_TIMESTAMP)
      result = !(observable instanceof Algorithm && timestamp >= observable.invalidatedSince)
    return result
  }

  private static createMethodTrap(h: ObjectHolder, m: MemberName, options: OptionsImpl): F<any> {
    const method = new MethodController(h, m)
    const methodTrap: F<any> = (...args: any[]): any =>
      method.call(false, args).ret
    Meta.set(methodTrap, Meta.Method, method)
    return methodTrap
  }

  private static applyMethodOptions(proto: any, m: MemberName, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<MethodOptions>, implicit: boolean): OptionsImpl {
    // Configure options
    const blank: any = Meta.acquire(proto, Meta.Blank)
    const existing: Algorithm | undefined = blank[m]
    const method = existing ? existing.method : new MethodController(NIL_HOLDER, m)
    const opts = existing ? existing.options : OptionsImpl.INITIAL
    const alg =  new Algorithm(method, NIL_REV, new OptionsImpl(body, opts, options, implicit))
    blank[m] = alg
    // Add to the list if it's a reaction
    if (alg.options.kind === Kind.Reaction && alg.options.throttling < Number.MAX_SAFE_INTEGER) {
      const reactions = Meta.acquire(proto, Meta.Reactions)
      reactions[m] = alg
    }
    else if (alg.options.kind === Kind.Reaction && alg.options.throttling >= Number.MAX_SAFE_INTEGER) {
      const reactions = Meta.getFrom(proto, Meta.Reactions)
      delete reactions[m]
    }
    return alg.options
  }

  // static freeze(c: CachedResult): void {
  //   Utils.freezeMap(c.observables)
  //   Object.freeze(c)
  // }

  static init(): void {
    Dbg.getMergedTraceOptions = getMergedTraceOptions
    Snapshot.markViewed = Algorithm.markViewed // override
    Snapshot.markChanged = Algorithm.markChanged // override
    Snapshot.isConflicting = Algorithm.isConflicting // override
    Snapshot.propagateChangesToReactions = Algorithm.propagateChangesToReactions // override
    Hooks.createMethodTrap = Algorithm.createMethodTrap // override
    Hooks.applyMethodOptions = Algorithm.applyMethodOptions // override
    Promise.prototype.then = reactronicHookedThen // override
    try {
      Object.defineProperty(globalThis, 'rWhy', {
        get: MethodController.whyFull, configurable: false, enumerable: false,
      })
      Object.defineProperty(globalThis, 'rWhyShort', {
        get: MethodController.whyShort, configurable: false, enumerable: false,
      })
    }
    catch (e) {
      // ignore
    }
    try {
      Object.defineProperty(global, 'rWhy', {
        get: MethodController.whyFull, configurable: false, enumerable: false,
      })
      Object.defineProperty(global, 'rWhyShort', {
        get: MethodController.whyShort, configurable: false, enumerable: false,
      })
    }
    catch (e) {
      // ignore
    }
  }
}

function propagationHint(cause: MemberRef, full: boolean): string[] {
  const result: string[] = []
  let observable: Observable = cause.revision.data[cause.member]
  while (observable instanceof Algorithm && observable.invalidatedDueTo) {
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
  else if (value instanceof Algorithm)
    result = `<recompute:${Hints.rev(value.revision.prev.revision)}>`
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
  if (Algorithm.current)
    res = Dbg.merge({margin2: Algorithm.current.margin}, undefined, undefined, res)
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
    const alg = Algorithm.current
    if (alg) {
      resolve = alg.bind(resolve)
      reject = alg.bind(reject)
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

Algorithm.init()
