// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { CacheOptions, Kind, Reentrance, TraceOptions, SnapshotOptions } from '../Options'
import { Worker } from '../Worker'
import { Controller } from '../Controller'
import { ObjectRevision, MemberName, ObjectHolder, Observable, MemberRef, Observer, Meta } from './Data'
import { Snapshot, Hints, NIL } from './Snapshot'
import { Transaction } from './Transaction'
import { Monitor, MonitorImpl } from './Monitor'
import { Hooks, OptionsImpl } from './Hooks'
import { TransactionJournalImpl } from './TransactionJournal'

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER
const NIL_HOLDER = new ObjectHolder(undefined, undefined, Hooks.proxy, NIL, 'N/A')

type Call = { snapshot: Snapshot, revision: ObjectRevision, computation: Computation, reuse: boolean }

export class MethodController extends Controller<any> {
  readonly holder: ObjectHolder
  readonly member: MemberName

  configure(options: Partial<CacheOptions>): CacheOptions { return MethodController.configureImpl(this, options) }
  get options(): CacheOptions { return this.weak().computation.options }
  get args(): ReadonlyArray<any> { return this.weak().computation.args }
  get value(): any { return this.call(true, undefined).value }
  get error(): boolean { return this.weak().computation.error }
  get stamp(): number { return this.weak().revision.snapshot.timestamp }
  get isInvalidated(): boolean { return !this.weak().reuse }
  invalidate(): void { Transaction.runAs({ hint: Dbg.isOn ? `invalidate(${Hints.obj(this.holder, this.member)})` : 'invalidate()' }, MethodController.invalidate, this) }
  getCachedValueAndRevalidate(args?: any[]): any { return this.call(true, args).value }

  constructor(holder: ObjectHolder, member: MemberName) {
    super()
    this.holder = holder
    this.member = member
  }

  call(weak: boolean, args: any[] | undefined): Computation {
    let call: Call = this.read(args)
    const ctx = call.snapshot
    const c: Computation = call.computation
    if (!call.reuse && call.revision.data[Meta.Disposed] === undefined
      && (!weak || c.invalidatedSince === -1 || !c.revalidation || c.revalidation.worker.isFinished)) {
      const opt = c.options
      const spawn = weak || opt.kind === Kind.Reaction ||
        (opt.kind === Kind.Cache && (call.revision.snapshot.sealed || call.revision.prev.revision !== NIL))
      const token = opt.noSideEffects ? this : undefined
      const call2 = this.compute(call, spawn, opt, token, args)
      const ctx2 = call2.computation.revision.snapshot
      if (!weak || ctx === ctx2 || (ctx2.sealed && ctx.timestamp >= ctx2.timestamp))
        call = call2
    }
    else if (Dbg.isOn && Dbg.trace.methods && (c.options.trace === undefined || c.options.trace.methods === undefined || c.options.trace.methods === true))
      Dbg.log(Transaction.current.isFinished ? '' : '║', ' (=)', `${Hints.revision(call.revision, this.member)} result is reused from T${call.computation.worker.id}[${call.computation.worker.hint}]`)
    const result = call.computation
    Snapshot.markViewed(result, call.revision, this.member, this.holder, result.options.kind, weak)
    return result
  }

  static of(method: F<any>): Controller<any> {
    const func = Meta.get<Controller<any> | undefined>(method, Meta.Method)
    if (!func)
      throw misuse(`given method is not decorated as reactronic one: ${method.name}`)
    return func
  }

  static configureImpl(self: MethodController | undefined, options: Partial<CacheOptions>): CacheOptions {
    let c: Computation | undefined
    if (self)
      c = self.write().computation
    else
      c = Computation.current
    if (!c || c.worker.isFinished)
      throw misuse('a method is expected with reactronic decorator')
    c.options = new OptionsImpl(c.options.body, c.options, options, false)
    if (Dbg.isOn && Dbg.trace.writes)
      Dbg.log('║', '  ♦', `${Hints.revision(c.revision, c.method.member)}.options = ...`)
    return c.options
  }

  static run<T>(c: Computation | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined
    const outer = Computation.current
    try {
      Computation.current = c
      result = func(...args)
    }
    catch (e) {
      if (c)
        c.error = e
      throw e
    }
    finally {
      Computation.current = outer
    }
    return result
  }

  static whyFull(): string {
    const c = Computation.current
    return c ? c.whyFull() : NIL_HOLDER.hint
  }

  static whyShort(): string {
    const c = Computation.current
    return c ? c.whyShort() : NIL_HOLDER.hint
  }

  /* istanbul ignore next */
  static deps(): string[] {
    const c = Computation.current
    return c ? c.deps() : ['Reactronic.deps should be called from inside of reactive method']
  }

  // Internal

  private weak(): Call {
    const call = this.read(undefined)
    Snapshot.markViewed(call.computation, call.revision, this.member, this.holder, call.computation.options.kind, true)
    return call
  }

  private read(args: any[] | undefined): Call {
    const ctx = Snapshot.readable()
    const r: ObjectRevision = ctx.lookup(this.holder, this.member)
    const c: Computation = this.from(r)
    const reuse = c.options.kind !== Kind.Transaction && c.invalidatedSince !== -1 &&
      (ctx === c.revision.snapshot || ctx.timestamp < c.invalidatedSince) &&
      (!c.options.sensitiveArgs || args === undefined || c.args.length === args.length && c.args.every((t, i) => t === args[i])) ||
      r.data[Meta.Disposed] !== undefined
    return { snapshot: ctx, revision: r, computation: c, reuse }
  }

  private write(): Call {
    const ctx = Snapshot.writable()
    const h = this.holder
    const m = this.member
    const r: ObjectRevision = ctx.findWritableRevision(h, m, Meta.Holder, this)
    let c: Computation = this.from(r)
    if (c.revision !== r) {
      const c2 = new Computation(this, r, c)
      c = r.data[m] = c2.reenterOver(c)
      ctx.bumpBy(r.prev.revision.snapshot.timestamp)
      Snapshot.markChanged(c, true, r, m, h)
    }
    return { snapshot: ctx, revision: r, computation: c, reuse: true }
  }

  private from(r: ObjectRevision): Computation {
    const m = this.member
    let c: Computation = r.data[m]
    if (c.method !== this) {
      const hint: string = Dbg.isOn ? `${Hints.obj(this.holder, m)}/initialize` : /* istanbul ignore next */ 'Cache.init'
      const spawn = r.snapshot.sealed || r.prev.revision !== NIL
      c = Transaction.runAs<Computation>({ hint, spawn, token: this }, (): Computation => {
        const h = this.holder
        let r2: ObjectRevision = Snapshot.readable().findReadableRevision(h, m)
        let c2 = r2.data[m] as Computation
        if (c2.method !== this) {
          r2 = Snapshot.writable().findWritableRevision(h, m, Meta.Holder, this)
          c2 = r2.data[m] = new Computation(this, r2, c2)
          c2.invalidatedSince = -1 // indicates blank value
          Snapshot.markChanged(c2, true, r2, m, h)
        }
        return c2
      })
    }
    return c
  }

  private compute(existing: Call, spawn: boolean, options: CacheOptions, token: any, args: any[] | undefined): Call {
    // TODO: Cleaner implementation is needed
    const hint: string = Dbg.isOn ? `${Hints.obj(this.holder, this.member)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? ` - ${args[0]}` : ''}` : /* istanbul ignore next */ `${Hints.obj(this.holder, this.member)}`
    let call = existing
    const opt = { hint, spawn, journal: options.journal, trace: options.trace, token }
    const ret = Transaction.runAs(opt, (argsx: any[] | undefined): any => {
      if (!call.computation.worker.isCanceled) { // first call
        call = this.write()
        if (Dbg.isOn && (Dbg.trace.transactions || Dbg.trace.methods || Dbg.trace.invalidations))
          Dbg.log('║', ' (f)', `${call.computation.whyFull()}`)
        call.computation.compute(this.holder.proxy, argsx)
      }
      else { // retry call
        call = this.read(argsx) // re-read on retry
        if (call.computation.options.kind === Kind.Transaction || !call.reuse) {
          call = this.write()
          if (Dbg.isOn && (Dbg.trace.transactions || Dbg.trace.methods || Dbg.trace.invalidations))
            Dbg.log('║', ' (f)', `${call.computation.whyFull()}`)
          call.computation.compute(this.holder.proxy, argsx)
        }
      }
      return call.computation.ret
    }, args)
    call.computation.ret = ret
    return call
  }

  private static invalidate(self: MethodController): void {
    const ctx = Snapshot.readable()
    const call = self.read(undefined)
    const c: Computation = call.computation
    c.invalidateDueTo(c, {revision: NIL, member: self.member, times: 0}, ctx.timestamp, ctx.reactions)
  }
}

// Computation

class Computation extends Observable implements Observer {
  static current?: Computation = undefined
  static asyncReactionsBatch: Computation[] = []

  get isComputation(): boolean { return true }
  readonly method: MethodController
  readonly revision: ObjectRevision
  readonly observables: Map<Observable, MemberRef>
  options: OptionsImpl
  cause: MemberRef | undefined
  args: any[]
  ret: any
  error: any
  readonly margin: number
  readonly worker: Worker
  started: number
  invalidatedDueTo: MemberRef | undefined
  invalidatedSince: number
  revalidation: Computation | undefined

  constructor(method: MethodController, revision: ObjectRevision, prev: Computation | OptionsImpl) {
    super(undefined)
    this.method = method
    this.revision = revision
    this.observables = new Map<Observable, MemberRef>()
    if (prev instanceof Computation) {
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
    this.margin = Computation.current ? Computation.current.margin + 1 : 1
    this.worker = Transaction.current
    this.started = 0
    this.invalidatedSince = 0
    this.invalidatedDueTo = undefined
    this.revalidation = undefined
  }

  hint(): string { return `${Hints.revision(this.revision, this.method.member)}` }
  get priority(): number { return this.options.priority }

  whyFull(): string {
    let ms: number = Date.now()
    const prev = this.revision.prev.revision.data[this.method.member]
    if (prev instanceof Computation)
      ms = Math.abs(this.started) - Math.abs(prev.started)
    let cause: string
    if (this.cause)
      cause = `   <<   ${propagationHint(this.cause, true).join('   <<   ')}`
    else if (this.method.options.kind === Kind.Transaction)
      cause = '   <<   transaction'
    else
      cause = `   <<   called by ${this.revision.snapshot.hint}`
    return `${Hints.revision(this.revision, this.method.member)}${cause}   (${ms}ms since previous revalidation)`
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
        Dbg.logAs({margin2: this.margin}, '║', '‾\\', `${Hints.revision(this.revision, this.method.member)} - step in  `, 0, '        │')
      const started = Date.now()
      const result = MethodController.run<T>(this, func, ...args)
      const ms = Date.now() - started
      if (Dbg.isOn && Dbg.trace.steps && this.ret)
        Dbg.logAs({margin2: this.margin}, '║', '_/', `${Hints.revision(this.revision, this.method.member)} - step out `, 0, this.started > 0 ? '        │' : '')
      if (ms > Hooks.mainThreadBlockingWarningThreshold) /* istanbul ignore next */
        Dbg.log('', '[!]', this.whyFull(), ms, '    *** main thread is too busy ***')
      return result
    }
    return cacheBound
  }

  compute(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.invalidatedSince = TOP_TIMESTAMP
    if (!this.error)
      MethodController.run<void>(this, Computation.compute, this, proxy)
    else
      this.ret = Promise.reject(this.error)
  }

  invalidateDueTo(observable: Observable, cause: MemberRef, since: number, reactions: Observer[]): void {
    if (this.invalidatedSince === TOP_TIMESTAMP || this.invalidatedSince <= 0) {
      const skip = !observable.isComputation &&
        cause.revision.snapshot === this.revision.snapshot &&
        cause.revision.changes.has(cause.member)
      if (!skip) {
        this.invalidatedDueTo = cause
        this.invalidatedSince = since
        const isReaction = this.options.kind === Kind.Reaction /*&& this.revision.data[Meta.Disposed] === undefined*/
        if (Dbg.isOn && (Dbg.trace.invalidations || this.options.trace?.invalidations))
          Dbg.log(Dbg.trace.transactions && !Snapshot.readable().sealed ? '║' : ' ', isReaction ? '█' : '▒', isReaction && cause.revision === NIL ? `${this.hint()} is a reaction and will run automatically (priority ${this.options.priority})` : `${this.hint()} is invalidated due to ${Hints.revision(cause.revision, cause.member)} since v${since}${isReaction ? ` and will run automatically (priority ${this.options.priority})` : ''}`)
        this.unsubscribeFromAll()
        if (isReaction) // stop cascade invalidation on reaction
          reactions.push(this)
        else if (this.observers) // cascade invalidation
          this.observers.forEach(c => c.invalidateDueTo(this, {revision: this.revision, member: this.method.member, times: 0}, since, reactions))
        const worker = this.worker
        if (!worker.isFinished && this !== observable) // restart after itself if canceled
          worker.cancel(new Error(`T${worker.id}[${worker.hint}] is canceled due to invalidation by ${Hints.revision(cause.revision, cause.member)}`), null)
      }
      else {
        if (Dbg.isOn && (Dbg.trace.invalidations || this.options.trace?.invalidations))
          Dbg.log(' ', 'x', `${this.hint()} invalidation is skipped for self-changed ${Hints.revision(cause.revision, cause.member)}`)

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
        !this.revalidation || this.revalidation.worker.isCanceled)) {
        try {
          const c: Computation = this.method.call(false, undefined)
          if (c.ret instanceof Promise)
            c.ret.catch(error => {
              if (c.options.kind === Kind.Reaction)
                misuse(`reaction ${Hints.revision(c.revision, c.method.member)} failed and will not run anymore: ${error}`, error)
            })
        }
        catch (e) {
          if (!nothrow)
            throw e
          else if (this.options.kind === Kind.Reaction)
            misuse(`reaction ${Hints.revision(this.revision, this.method.member)} failed and will not run anymore: ${e}`, e)
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

  reenterOver(head: Computation): this {
    let error: Error | undefined = undefined
    const existing = head.revalidation
    if (existing && !existing.worker.isFinished) {
      if (Dbg.isOn && Dbg.trace.invalidations)
        Dbg.log('║', ' [!]', `${Hints.revision(this.revision, this.method.member)} is trying to re-enter over ${Hints.revision(existing.revision, existing.method.member)}`)
      switch (head.options.reentrance) {
        case Reentrance.PreventWithError:
          if (!existing.worker.isCanceled)
            throw misuse(`${head.hint()} (${head.whyFull()}) is not reentrant over ${existing.hint()} (${existing.whyFull()})`)
          error = new Error(`T${this.worker.id}[${this.worker.hint}] is on hold/PreventWithError due to canceled T${existing.worker.id}[${existing.worker.hint}]`)
          this.worker.cancel(error, existing.worker)
          break
        case Reentrance.WaitAndRestart:
          error = new Error(`T${this.worker.id}[${this.worker.hint}] is on hold/WaitAndRestart due to active T${existing.worker.id}[${existing.worker.hint}]`)
          this.worker.cancel(error, existing.worker)
          break
        case Reentrance.CancelAndWaitPrevious:
          error = new Error(`T${this.worker.id}[${this.worker.hint}] is on hold/CancelAndWaitPrevious due to active T${existing.worker.id}[${existing.worker.hint}]`)
          this.worker.cancel(error, existing.worker)
          existing.worker.cancel(new Error(`T${existing.worker.id}[${existing.worker.hint}] is canceled due to re-entering T${this.worker.id}[${this.worker.hint}]`), null)
          break
        case Reentrance.CancelPrevious:
          existing.worker.cancel(new Error(`T${existing.worker.id}[${existing.worker.hint}] is canceled due to re-entering T${this.worker.id}[${this.worker.hint}]`), null)
          break
        case Reentrance.RunSideBySide:
          break // do nothing
      }
    }
    if (!error)
      head.revalidation = this
    else
      this.error = error
    return this
  }

  // Internal

  private static compute(self: Computation, proxy: any): void {
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
      Dbg.log('║', '‾\\', `${Hints.revision(this.revision, this.method.member)} - enter`)
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
          Dbg.log('║', '_/', `${Hints.revision(this.revision, this.method.member)} - leave... `, 0, 'ASYNC ──┐')
        else if (Dbg.trace.transactions)
          Dbg.log('║', '  ', `${Hints.revision(this.revision, this.method.member)}... `, 0, 'ASYNC')
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
      Dbg.log('║', `${op}`, `${Hints.revision(this.revision, this.method.member)} ${message}`, ms, highlight)
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
    Computation.asyncReactionsBatch.push(this)
    if (Computation.asyncReactionsBatch.length === 1)
      setTimeout(Computation.processAsyncReactionsBatch, 0)
  }

  private static processAsyncReactionsBatch(): void {
    const reactions = Computation.asyncReactionsBatch
    Computation.asyncReactionsBatch = [] // reset
    for (const t of reactions)
      t.revalidate(true, true)
  }

  private static markViewed(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, kind: Kind, weak: boolean): void {
    if (kind !== Kind.Transaction) {
      const c: Computation | undefined = Computation.current // alias
      if (c && c.options.kind !== Kind.Transaction && m !== Meta.Holder) {
        const ctx = Snapshot.readable()
        if (ctx !== r.snapshot) // snapshot should not bump itself
          ctx.bumpBy(r.snapshot.timestamp)
        const t = weak ? -1 : ctx.timestamp
        if (!c.subscribeTo(observable, r, m, h, t))
          c.invalidateDueTo(observable, {revision: r, member: m, times: 0}, ctx.timestamp, ctx.reactions)
      }
    }
  }

  private static markChanged(value: any, changed: boolean, r: ObjectRevision, m: MemberName, h: ObjectHolder): void {
    changed ? r.changes.add(m) : r.changes.delete(m)
    if (Dbg.isOn && Dbg.trace.writes)
      changed ? Dbg.log('║', '  ♦', `${Hints.revision(r, m)} = ${valueHint(value)}`) : Dbg.log('║', '  ♦', `${Hints.revision(r, m)} = ${valueHint(value)}`, undefined, ' (same as previous)')
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof Computation && oldValue.invalidatedSince !== -1
    return result
  }

  private static finalizeChangeset(snapshot: Snapshot, error: Error | undefined): void {
    const since = snapshot.timestamp
    if (!error) {
      // Mark previous values as replaced, invalidate observers, and reset recomputing status
      const reactions = snapshot.reactions
      snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
        if (!r.changes.has(Meta.Disposed))
          r.changes.forEach(m => Computation.finalizeMemberChange(false, since, r, m, h, reactions))
        else
          for (const m in r.prev.revision.data)
            Computation.finalizeMemberChange(true, since, r, m, h, reactions)
        if (Dbg.isOn)
          Snapshot.freezeObjectRevision(r)
      })
      reactions.sort(Computation.compareReactionsByPriority)
      const log = snapshot.options.journal
      log && log.remember(TransactionJournalImpl.createPatch(snapshot.hint, snapshot.changeset))
    }
    else
      snapshot.changeset.forEach((r: ObjectRevision, h: ObjectHolder) =>
        r.changes.forEach(m => Computation.finalizeMemberChange(true, since, r, m, h)))
  }

  private static compareReactionsByPriority(a: Observer, b: Observer): number {
    return a.priority - b.priority
  }

  private static finalizeMemberChange(unsubscribe: boolean, timestamp: number,
    r: ObjectRevision, m: MemberName, h: ObjectHolder, reactions?: Observer[]): void {
    if (reactions) {
      const prev = r.prev.revision.data[m]
      // if (prev !== undefined) {
      //   if ((prev.next === undefined) !== (prev === h.head.data[m]))
      //     console.log('(!!!)')
      // }
      if (prev !== undefined && prev instanceof Observable && prev.next === undefined) {
        if (unsubscribe) // in fact it means disposal if reactions are not undefined
          r.data[m] = Meta.Disposed
        prev.next = r
        const cause: MemberRef = { revision: r, member: m, times: 0 }
        if (prev instanceof Computation && (prev.invalidatedSince === TOP_TIMESTAMP || prev.invalidatedSince <= 0)) {
          prev.invalidatedDueTo = cause
          prev.invalidatedSince = timestamp
          prev.unsubscribeFromAll()
        }
        if (prev.observers)
          prev.observers.forEach(c => c.invalidateDueTo(prev, cause, timestamp, reactions))
      }
    }
    const value = r.data[m]
    if (value instanceof Computation) {
      if (value.revision === r) {
        if (unsubscribe)
          value.unsubscribeFromAll()
        // Clear recomputing status of previous cached result
        // const prev = cache.revision.prev.revision.data[m]
        // if (prev instanceof CallResult && prev.revalidation === cache)
        //   prev.revalidation = undefined
        // Performance tracking
        if (Hooks.repetitiveReadWarningThreshold < Number.MAX_SAFE_INTEGER) {
          value.observables.forEach((hint, v) => {
            if (hint.times > Hooks.repetitiveReadWarningThreshold) Dbg.log('', '[!]', `${value.hint()} uses ${Hints.revision(hint.revision, hint.member)} ${hint.times} times (consider remembering it in a local variable)`, 0, ' *** WARNING ***')
          })
        }
      }
    }
    else if (value instanceof Observable && value.observers) {
      value.observers.forEach(o => {
        o.observables.delete(value)
        if (Dbg.isOn && Dbg.trace.reads)
          Dbg.log(Dbg.trace.transactions && !Snapshot.readable().sealed ? '║' : ' ', '-', `${o.hint()} is unsubscribed from self-changed ${Hints.revision(r, m)}`)
      })
      value.observers = undefined
    }
  }

  private unsubscribeFromAll(): void {
    // It's critical to have on exceptions here
    this.observables.forEach((hint, value) => {
      const observers = value.observers
      if (observers)
        observers.delete(this)
      if (Dbg.isOn && (Dbg.trace.reads || this.options.trace?.reads))
        Dbg.log(Dbg.trace.transactions && !Snapshot.readable().sealed ? '║' : ' ', '-', `${Hints.revision(this.revision, this.method.member)} is unsubscribed from ${Hints.revision(hint.revision, hint.member)}`)
    })
    this.observables.clear()
  }

  private subscribeTo(observable: Observable, r: ObjectRevision, m: MemberName, h: ObjectHolder, timestamp: number): boolean {
    let isValid = !r.snapshot.sealed || observable === h.head.data[m]
    if (isValid)
      isValid = !(observable instanceof Computation && timestamp >= observable.invalidatedSince)
    if (isValid && timestamp !== -1) {
      // Performance tracking
      let times: number = 0
      if (Hooks.repetitiveReadWarningThreshold < Number.MAX_SAFE_INTEGER) {
        const existing = this.observables.get(observable)
        times = existing ? existing.times + 1 : 1
      }
      // Acquire observers
      if (!observable.observers)
        observable.observers = new Set<Computation>()
      // Two-way linking
      const member: MemberRef = {revision: r, member: m, times}
      observable.observers.add(this)
      this.observables.set(observable, member)
      if (Dbg.isOn && (Dbg.trace.reads || this.options.trace?.reads))
        Dbg.log('║', '  ∞ ', `${Hints.revision(this.revision, this.method.member)} is subscribed to ${Hints.revision(r, m)}${member.times > 1 ? ` (${member.times} times)` : ''}`)
    }
    else {
      if (Dbg.isOn && (Dbg.trace.reads || this.options.trace?.reads))
        Dbg.log('║', '  x ', `${Hints.revision(this.revision, this.method.member)} is NOT subscribed to ${Hints.revision(r, m)}`)
    }
    return isValid // || observable.next === r
  }

  private static createMethodTrap(h: ObjectHolder, m: MemberName, options: OptionsImpl): F<any> {
    const method = new MethodController(h, m)
    const methodTrap: F<any> = (...args: any[]): any =>
      method.call(false, args).ret
    Meta.set(methodTrap, Meta.Method, method)
    return methodTrap
  }

  private static applyMethodOptions(proto: any, m: MemberName, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<CacheOptions>, implicit: boolean): OptionsImpl {
    // Configure options
    const blank: any = Meta.acquire(proto, Meta.Blank)
    const existing: Computation | undefined = blank[m]
    const method = existing ? existing.method : new MethodController(NIL_HOLDER, m)
    const opts = existing ? existing.options : OptionsImpl.INITIAL
    const value =  new Computation(method, NIL, new OptionsImpl(body, opts, options, implicit))
    blank[m] = value
    // Add to the list if it's a reaction
    if (value.options.kind === Kind.Reaction && value.options.throttling < Number.MAX_SAFE_INTEGER) {
      const reactions = Meta.acquire(proto, Meta.Reactions)
      reactions[m] = value
    }
    else if (value.options.kind === Kind.Reaction && value.options.throttling >= Number.MAX_SAFE_INTEGER) {
      const reactions = Meta.from<any>(proto, Meta.Reactions)
      delete reactions[m]
    }
    return value.options
  }

  // static freeze(c: CachedResult): void {
  //   Utils.freezeMap(c.observables)
  //   Object.freeze(c)
  // }

  static init(): void {
    Dbg.getMergedTraceOptions = getMergedTraceOptions
    Snapshot.markViewed = Computation.markViewed // override
    Snapshot.markChanged = Computation.markChanged // override
    Snapshot.isConflicting = Computation.isConflicting // override
    Snapshot.finalizeChangeset = Computation.finalizeChangeset // override
    Hooks.createMethodTrap = Computation.createMethodTrap // override
    Hooks.applyMethodOptions = Computation.applyMethodOptions // override
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
  while (observable instanceof Computation && observable.invalidatedDueTo) {
    full && result.push(Hints.revision(cause.revision, cause.member))
    cause = observable.invalidatedDueTo
    observable = cause.revision.data[cause.member]
  }
  result.push(Hints.revision(cause.revision, cause.member))
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
  else if (value instanceof Computation)
    result = `<recompute:${Hints.revision(value.revision.prev.revision)}>`
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
  if (Computation.current)
    res = Dbg.merge({margin2: Computation.current.margin}, undefined, undefined, res)
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
    const cache = Computation.current
    if (cache) {
      resolve = cache.bind(resolve)
      reject = cache.bind(reject)
    }
    resolve = tran.bind(resolve, false)
    reject = tran.bind(reject, true)
  }
  return ORIGINAL_PROMISE_THEN.call(this, resolve, reject)
}

/* istanbul ignore next */
export function resolveReturn(value: any): any {
  return value
}

/* istanbul ignore next */
export function rejectRethrow(error: any): never {
  throw error
}

Computation.init()
