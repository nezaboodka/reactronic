// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F, Utils } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Record, Member, Handle, Observable, MemberHint, Observer } from './Data'
import { Snapshot, Hints, NIL, SYM_HANDLE, SYM_METHOD, SYM_UNMOUNT, SYM_BLANK, SYM_TRIGGERS } from './Snapshot'
import { TransactionImpl } from './TransactionImpl'
import { MonitorImpl } from './MonitorImpl'
import { Hooks, OptionsImpl } from './Hooks'
import { Options, Kind, Reentrance, LoggingOptions } from '../Options'
import { Monitor, Worker } from '../Monitor'
import { Cache } from '../Cache'

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER
const NIL_HANDLE = new Handle(undefined, undefined, Hooks.proxy, NIL, 'nil')

type Call = { context: Snapshot, record: Record, result: CallResult, reuse: boolean }

export class Method extends Cache<any> {
  readonly handle: Handle
  readonly member: Member

  configure(options: Partial<Options>): Options { return Method.configureImpl(this, options) }
  get options(): Options { return this.weak().result.options }
  get args(): ReadonlyArray<any> { return this.weak().result.args }
  get value(): any { return this.call(true, undefined).value }
  get error(): boolean { return this.weak().result.error }
  get stamp(): number { return this.weak().record.snapshot.timestamp }
  get invalid(): boolean { return !this.weak().reuse }
  invalidate(): void { TransactionImpl.run(Dbg.isOn ? `invalidate(${Hints.obj(this.handle, this.member)})` : 'invalidate()', Method.invalidate, this) }
  getCachedAndRevalidate(args?: any[]): any { return this.call(true, args).value }

  constructor(handle: Handle, member: Member) {
    super()
    this.handle = handle
    this.member = member
  }

  call(weak: boolean, args: any[] | undefined): CallResult {
    let call: Call = this.read(args)
    const ctx = call.context
    const c: CallResult = call.result
    if (!call.reuse && call.record.data[SYM_UNMOUNT] === undefined
      && (!weak || !c.revalidation || c.revalidation.worker.isFinished)) {
      const opt = c.options
      const spawn = weak || opt.kind === Kind.Trigger ||
        (opt.kind === Kind.Cached && (call.record.snapshot.completed || call.record.prev.record !== NIL))
      const token = opt.noSideEffects ? this : undefined
      const call2 = this.compute(call, spawn, opt.logging, token, args)
      const ctx2 = call2.result.record.snapshot
      if (!weak || ctx === ctx2 || (ctx2.completed && ctx.timestamp >= ctx2.timestamp))
        call = call2
    }
    else if (Dbg.isOn && Dbg.logging.methods && (c.options.logging === undefined || c.options.logging.methods === undefined || c.options.logging.methods === true))
      Dbg.log(TransactionImpl.current.isFinished ? '' : '║', ' (=)', `${Hints.record(call.record, this.member)} result is reused from T${call.result.worker.id} ${call.result.worker.hint}`)
    const result = call.result
    Snapshot.markViewed(call.record, this.member, result, result.options.kind, weak)
    return result
  }

  static getCache(method: F<any>): Cache<any> {
    const func = Utils.get<Cache<any> | undefined>(method, SYM_METHOD)
    if (!func)
      throw misuse(`given method is not decorated as reactronic one: ${method.name}`)
    return func
  }

  static configureImpl(self: Method | undefined, options: Partial<Options>): Options {
    let c: CallResult | undefined
    if (self)
      c = self.write().result
    else
      c = CallResult.current
    if (!c || c.worker.isFinished)
      throw misuse('a method is expected with reactronic decorator')
    c.options = new OptionsImpl(c.options.body, c.options, options, false)
    if (Dbg.isOn && Dbg.logging.writes)
      Dbg.log('║', '  ♦', `${Hints.record(c.record, c.method.member)}.options = ...`)
    return c.options
  }

  static run<T>(c: CallResult | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined
    const outer = CallResult.current
    try {
      CallResult.current = c
      result = func(...args)
    }
    catch (e) {
      if (c)
        c.error = e
      throw e
    }
    finally {
      CallResult.current = outer
    }
    return result
  }

  static why(): string {
    const c = CallResult.current
    return c ? c.why() : 'Reactronic.why should be called from inside of reactive method'
  }

  static deps(): string[] {
    const c = CallResult.current
    return c ? c.deps() : ['Reactronic.deps should be called from inside of reactive method']
  }

  // Internal

  private weak(): Call {
    const call = this.read(undefined)
    Snapshot.markViewed(call.record, this.member, call.result, call.result.options.kind, true)
    return call
  }

  private read(args: any[] | undefined): Call {
    const ctx = Snapshot.readable()
    const r: Record = ctx.tryRead(this.handle)
    const c: CallResult = this.from(r)
    const reuse = c.options.kind !== Kind.Transaction &&
      ((ctx === c.record.snapshot && c.invalidatedSince !== -1) || ctx.timestamp < c.invalidatedSince) &&
      (!c.options.sensitiveArgs || args === undefined || c.args.length === args.length && c.args.every((t, i) => t === args[i])) ||
      r.data[SYM_UNMOUNT] !== undefined
    return { context: ctx, record: r, result: c, reuse }
  }

  private write(): Call {
    const ctx = Snapshot.writable()
    const m = this.member
    const r: Record = ctx.write(this.handle, m, SYM_HANDLE, this)
    let c: CallResult = this.from(r)
    if (c.record !== r) {
      const c2 = new CallResult(this, r, c)
      c = r.data[m] = c2.reenterOver(c)
      ctx.bumpDueTo(r.prev.record)
      Snapshot.markChanged(r, m, c, true)
    }
    return { context: ctx, record: r, result: c, reuse: true }
  }

  private from(r: Record): CallResult {
    const m = this.member
    let c: CallResult = r.data[m]
    if (c.method !== this) {
      const hint: string = Dbg.isOn ? `${Hints.obj(this.handle, m)}/initialize` : /* istanbul ignore next */ 'Cache.init'
      const spawn = r.snapshot.completed || r.prev.record !== NIL
      c = TransactionImpl.runAs<CallResult>(hint, spawn, undefined, this, (): CallResult => {
        const h = this.handle
        let r2: Record = Snapshot.readable().read(h)
        let c2 = r2.data[m] as CallResult
        if (c2.method !== this) {
          r2 = Snapshot.writable().write(h, m, SYM_HANDLE, this)
          c2 = r2.data[m] = new CallResult(this, r2, c2)
          c2.invalidatedSince = -1 // indicates blank value
          Snapshot.markChanged(r2, m, c2, true)
        }
        return c2
      })
    }
    return c
  }

  private compute(existing: Call, spawn: boolean, logging: Partial<LoggingOptions> | undefined, token: any, args: any[] | undefined): Call {
    // TODO: Cleaner implementation is needed
    const hint: string = Dbg.isOn ? `${Hints.obj(this.handle, this.member)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? `/${args[0]}` : ''}` : /* istanbul ignore next */ `${Hints.obj(this.handle, this.member)}`
    let call = existing
    const ret = TransactionImpl.runAs(hint, spawn, logging, token, (argsx: any[] | undefined): any => {
      if (!call.result.worker.isCanceled) { // first call
        call = this.write()
        if (Dbg.isOn && (Dbg.logging.transactions || Dbg.logging.methods || Dbg.logging.invalidations))
          Dbg.log('║', ' (f)', `${call.result.why()}`)
        call.result.compute(this.handle.proxy, argsx)
      }
      else { // retry call
        call = this.read(argsx) // re-read on retry
        if (call.result.options.kind === Kind.Transaction || !call.reuse) {
          call = this.write()
          if (Dbg.isOn && (Dbg.logging.transactions || Dbg.logging.methods || Dbg.logging.invalidations))
            Dbg.log('║', ' (f)', `${call.result.why()}`)
          call.result.compute(this.handle.proxy, argsx)
        }
      }
      return call.result.ret
    }, args)
    call.result.ret = ret
    return call
  }

  private static invalidate(self: Method): void {
    const ctx = Snapshot.readable()
    const call = self.read(undefined)
    const c: CallResult = call.result
    c.invalidateDueTo(c, {record: NIL, member: self.member, times: 0}, ctx.timestamp, ctx.triggers)
  }
}

// CallResult

class CallResult extends Observable implements Observer {
  static current?: CallResult = undefined
  static asyncTriggerBatch: CallResult[] = []

  get isField(): boolean { return false }
  readonly method: Method
  readonly record: Record
  readonly observables: Map<Observable, MemberHint>
  options: OptionsImpl
  cause: MemberHint | undefined
  args: any[]
  ret: any
  error: any
  readonly margin: number
  readonly worker: Worker
  started: number
  invalidatedDueTo: MemberHint | undefined
  invalidatedSince: number
  revalidation: CallResult | undefined

  constructor(method: Method, record: Record, prev: CallResult | OptionsImpl) {
    super(undefined)
    this.method = method
    this.record = record
    this.observables = new Map<Observable, MemberHint>()
    if (prev instanceof CallResult) {
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
    this.margin = CallResult.current ? CallResult.current.margin + 1 : 1
    this.worker = TransactionImpl.current
    this.started = 0
    this.invalidatedSince = 0
    this.invalidatedDueTo = undefined
    this.revalidation = undefined
  }

  hint(): string { return `${Hints.record(this.record, this.method.member)}` }
  priority(): number { return this.options.priority }

  why(): string {
    let ms: number = Date.now()
    const prev = this.record.prev.record.data[this.method.member]
    if (prev instanceof CallResult)
      ms = Math.abs(this.started) - Math.abs(prev.started)
    let cause: string
    if (this.cause)
      cause = `   <<   ${propagationHint(this.cause).join('   <<   ')}`
    else if (this.method.options.kind === Kind.Transaction)
      cause = '   <<   transaction'
    else
      cause = `   <<   first on-demand call by ${this.record.snapshot.hint}`
    return `${Hints.record(this.record, this.method.member)}${cause}   (${ms}ms since previous revalidation)`
  }

  deps(): string[] {
    throw misuse('not implemented yet')
  }

  bind<T>(func: F<T>): F<T> {
    const cacheBound: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.logging.steps && this.ret)
        Dbg.logAs({margin2: this.margin}, '║', '‾\\', `${Hints.record(this.record, this.method.member)} - step in  `, 0, '        │')
      const started = Date.now()
      const result = Method.run<T>(this, func, ...args)
      const ms = Date.now() - started
      if (Dbg.isOn && Dbg.logging.steps && this.ret)
        Dbg.logAs({margin2: this.margin}, '║', '_/', `${Hints.record(this.record, this.method.member)} - step out `, 0, this.started > 0 ? '        │' : '')
      if (ms > Hooks.mainThreadBlockingWarningThreshold)
        Dbg.log('', '[!]', this.why(), ms, '    *** main thread is too busy ***')
      return result
    }
    return cacheBound
  }

  compute(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.invalidatedSince = TOP_TIMESTAMP
    if (!this.error)
      Method.run<void>(this, CallResult.compute, this, proxy)
    else
      this.ret = Promise.reject(this.error)
  }

  invalidateDueTo(value: Observable, cause: MemberHint, since: number, triggers: Observer[]): void {
    if (this.invalidatedSince === TOP_TIMESTAMP || this.invalidatedSince <= 0) {
      const notSelfInvalidation = !value.isField ||
        cause.record.snapshot !== this.record.snapshot ||
        !cause.record.changes.has(cause.member)
      if (notSelfInvalidation) {
        this.invalidatedDueTo = cause
        this.invalidatedSince = since
        const isTrigger = this.options.kind === Kind.Trigger /*&& this.record.data[SYM_UNMOUNT] === undefined*/
        if (Dbg.isOn && Dbg.logging.invalidations || (this.options.logging && this.options.logging.invalidations))
          Dbg.logAs(this.options.logging, Dbg.logging.transactions && !Snapshot.readable().completed ? '║' : ' ', isTrigger ? '█' : '▒', isTrigger && cause.record === NIL ? `${this.hint()} is a trigger and will run automatically (priority ${this.options.priority})` : `${this.hint()} is invalidated by ${Hints.record(cause.record, cause.member)} since v${since}${isTrigger ? ` and will run automatically (priority ${this.options.priority})` : ''}`)
        this.unsubscribeFromAll()
        if (isTrigger) // stop cascade invalidation on trigger
          triggers.push(this)
        else if (this.observers) // cascade invalidation
          this.observers.forEach(c => c.invalidateDueTo(this, {record: this.record, member: this.method.member, times: 0}, since, triggers))
        const w = this.worker
        if (!w.isFinished && this !== value)
          w.cancel(new Error(`T${w.id} (${w.hint}) should be restarted due to invalidation by ${Hints.record(cause.record, cause.member)}`), w)
      }
      else if (Dbg.isOn && Dbg.logging.invalidations || (this.options.logging && this.options.logging.invalidations))
        Dbg.logAs(this.options.logging, '║', 'x', `${this.hint()} self-invalidation is skipped`)
    }
  }

  revalidate(now: boolean, nothrow: boolean): void {
    const t = this.options.throttling
    const interval = Date.now() + this.started // "started" is stored as negative value after trigger completion
    const hold = t ? t - interval : 0 // "started" is stored as negative value after trigger completion
    if (now || hold < 0) {
      if (!this.error && (this.options.kind === Kind.Transaction ||
        !this.revalidation || this.revalidation.worker.isCanceled)) {
        try {
          const c: CallResult = this.method.call(false, undefined)
          if (c.ret instanceof Promise)
            c.ret.catch(error => {
              if (c.options.kind === Kind.Trigger)
                misuse(`trigger ${Hints.record(c.record, c.method.member)} failed and will not run anymore: ${error}`)
            })
        }
        catch (e) {
          if (!nothrow)
            throw e
          else if (this.options.kind === Kind.Trigger)
            misuse(`trigger ${Hints.record(this.record, this.method.member)} failed and will not run anymore: ${e}`)
        }
      }
    }
    else if (t < Number.MAX_SAFE_INTEGER) {
      if (hold > 0)
        setTimeout(() => this.revalidate(true, true), hold)
      else
        this.addToAsyncTriggerBatch()
    }
  }

  reenterOver(head: CallResult): this {
    let error: Error | undefined = undefined
    const existing = head.revalidation
    if (existing && !existing.worker.isFinished) {
      if (Dbg.isOn && Dbg.logging.invalidations)
        Dbg.log('║', ' [!]', `${Hints.record(this.record, this.method.member)} is trying to re-enter over ${Hints.record(existing.record, existing.method.member)}`)
      switch (head.options.reentrance) {
        case Reentrance.PreventWithError:
          throw misuse(`${head.hint()} (${head.why()}) is not reentrant over ${existing.hint()} (${existing.why()})`)
        case Reentrance.WaitAndRestart:
          error = new Error(`T${this.worker.id} (${this.worker.hint}) is blocked by running T${existing.worker.id} (${existing.worker.hint})`)
          this.worker.cancel(error, existing.worker)
          break
        case Reentrance.CancelAndWaitPrevious:
          error = new Error(`T${this.worker.id} (${this.worker.hint}) is blocked by running T${existing.worker.id} (${existing.worker.hint})`)
          this.worker.cancel(error, existing.worker)
          existing.worker.cancel(new Error(`T${existing.worker.id} (${existing.worker.hint}) is canceled by re-entering T${this.worker.id} (${this.worker.hint})`), null)
          break
        case Reentrance.CancelPrevious:
          existing.worker.cancel(new Error(`T${existing.worker.id} (${existing.worker.hint}) is canceled by re-entering T${this.worker.id} (${this.worker.hint})`), null)
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

  private static compute(self: CallResult, proxy: any): void {
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
    if (Dbg.isOn && Dbg.logging.methods)
      Dbg.log('║', '‾\\', `${Hints.record(this.record, this.method.member)} - enter`)
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
        if (Dbg.logging.methods)
          Dbg.log('║', '_/', `${Hints.record(this.record, this.method.member)} - leave... `, 0, 'ASYNC ──┐')
        else if (Dbg.logging.transactions)
          Dbg.log('║', '  ', `${Hints.record(this.record, this.method.member)}... `, 0, 'ASYNC')
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
    if (Dbg.isOn && Dbg.logging.methods)
      Dbg.log('║', `${op}`, `${Hints.record(this.record, this.method.member)} ${message}`, ms, highlight)
    if (ms > (main ? Hooks.mainThreadBlockingWarningThreshold : Hooks.asyncActionDurationWarningThreshold)) Dbg.log('', '[!]', this.why(), ms, main ? '    *** main thread is too busy ***' : '    *** async is too long ***')
    if (this.options.monitor)
      this.monitorLeave(this.options.monitor)
    // CachedResult.freeze(this)
  }

  private monitorEnter(mon: Monitor): void {
    Method.run<void>(undefined, TransactionImpl.runAs, 'Monitor.enter',
      true, Dbg.isOn && Dbg.logging.monitors ? undefined : Dbg.global, undefined,
      MonitorImpl.enter, mon, this.worker)
  }

  private monitorLeave(mon: Monitor): void {
    TransactionImpl.isolated<void>(() => {
      const leave = (): void => {
        Method.run<void>(undefined, TransactionImpl.runAs, 'Monitor.leave',
          true, Dbg.isOn && Dbg.logging.monitors ? undefined : Dbg.DefaultLevel, undefined,
          MonitorImpl.leave, mon, this.worker)
      }
      this.worker.whenFinished().then(leave, leave)
    })
  }

  private addToAsyncTriggerBatch(): void {
    CallResult.asyncTriggerBatch.push(this)
    if (CallResult.asyncTriggerBatch.length === 1)
      setTimeout(CallResult.processAsyncTriggerBatch, 0)
  }

  private static processAsyncTriggerBatch(): void {
    const triggers = CallResult.asyncTriggerBatch
    CallResult.asyncTriggerBatch = [] // reset
    for (const t of triggers)
      t.revalidate(true, true)
  }

  private static markViewed(r: Record, m: Member, value: Observable, kind: Kind, weak: boolean): void {
    if (kind !== Kind.Transaction) {
      const c: CallResult | undefined = CallResult.current // alias
      if (c && c.options.kind !== Kind.Transaction && m !== SYM_HANDLE) {
        const ctx = Snapshot.readable()
        ctx.bumpDueTo(r)
        const t = weak ? -1 : ctx.timestamp
        if (!c.subscribeTo(r, m, value, t))
          c.invalidateDueTo(value, {record: r, member: m, times: 0}, ctx.timestamp, ctx.triggers)
      }
    }
  }

  private static markChanged(r: Record, m: Member, value: any, changed: boolean): void {
    changed ? r.changes.add(m) : r.changes.delete(m)
    if (Dbg.isOn && Dbg.logging.writes)
      changed ? Dbg.log('║', '  ♦', `${Hints.record(r, m)} = ${valueHint(value)}`) : Dbg.log('║', '  ♦', `${Hints.record(r, m)} = ${valueHint(value)}`, undefined, ' (same as previous)')
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof CallResult && oldValue.invalidatedSince !== -1
    return result
  }

  private static finalizeChangeset(snapshot: Snapshot, error: Error | undefined): void {
    const since = snapshot.timestamp
    if (!error) {
      // Mark previous values as replaced, invalidate observers, and reset recomputing status
      const triggers = snapshot.triggers
      snapshot.changeset.forEach((r: Record, h: Handle) => {
        if (!r.changes.has(SYM_UNMOUNT))
          r.changes.forEach(m => CallResult.finalizeChange(false, since, r, m, triggers))
        else
          for (const m in r.prev.record.data)
            CallResult.finalizeChange(true, since, r, m, triggers)
      })
      triggers.sort(CallResult.compareTriggersByPriority)
    }
    else {
      snapshot.changeset.forEach((r: Record, h: Handle) =>
        r.changes.forEach(m => CallResult.finalizeChange(true, since, r, m)))
    }
  }

  private static compareTriggersByPriority(a: Observer, b: Observer): number {
    return a.priority() - b.priority()
  }

  private static finalizeChange(unsubscribe: boolean, timestamp: number, r: Record, m: Member, triggers?: Observer[]): void {
    if (triggers) {
      const prev = r.prev.record.data[m] as Observable
      if (prev !== undefined && prev instanceof Observable && prev.replacement === undefined) {
        prev.replacement = r
        const cause: MemberHint = { record: r, member: m, times: 0 }
        if (prev instanceof CallResult && (prev.invalidatedSince === TOP_TIMESTAMP || prev.invalidatedSince <= 0)) {
          prev.invalidatedDueTo = cause
          prev.invalidatedSince = timestamp
          prev.unsubscribeFromAll()
        }
        if (prev.observers)
          prev.observers.forEach(c => c.invalidateDueTo(prev, cause, timestamp, triggers))
      }
    }
    const cache = r.data[m]
    if (cache instanceof CallResult && cache.record === r) {
      if (unsubscribe)
        cache.unsubscribeFromAll()
      // Clear recomputing status of previous cached result
      // const prev = cache.record.prev.record.data[m]
      // if (prev instanceof CallResult && prev.revalidation === cache)
      //   prev.revalidation = undefined
      // Performance tracking
      if (Hooks.repetitiveReadWarningThreshold < Number.MAX_SAFE_INTEGER) {
        cache.observables.forEach((hint, value) => {
          if (hint.times > Hooks.repetitiveReadWarningThreshold) Dbg.log('', '[!]', `${cache.hint()} uses ${Hints.record(hint.record, hint.member)} ${hint.times} times (consider remembering it in local variable)`, 0, ' *** WARNING ***')
        })
      }
    }
  }

  private unsubscribeFromAll(): void {
    // It's critical to have on exceptions here
    this.observables.forEach((hint, value) => {
      const observers = value.observers
      if (observers)
        observers.delete(this)
      if ((Dbg.isOn && Dbg.logging.reads || (this.options.logging && this.options.logging.reads))) Dbg.logAs(this.options.logging, Dbg.logging.transactions && !Snapshot.readable().completed ? '║' : ' ', '-', `${Hints.record(this.record, this.method.member)} is unsubscribed from ${Hints.record(hint.record, hint.member, true)}`)
    })
    this.observables.clear()
  }

  private subscribeTo(r: Record, m: Member, value: Observable, timestamp: number): boolean {
    let result = value.replacement === undefined
    if (result && timestamp !== -1)
      result = !(value instanceof CallResult && timestamp >= value.invalidatedSince)
    if (result) {
      // Performance tracking
      let times: number = 0
      if (Hooks.repetitiveReadWarningThreshold < Number.MAX_SAFE_INTEGER) {
        const existing = this.observables.get(value)
        times = existing ? existing.times + 1 : 1
      }
      // Acquire observers
      if (!value.observers)
        value.observers = new Set<CallResult>()
      // Two-way linking
      const hint: MemberHint = {record: r, member: m, times}
      value.observers.add(this)
      this.observables.set(value, hint)
      if ((Dbg.isOn && Dbg.logging.reads || (this.options.logging && this.options.logging.reads))) Dbg.logAs(this.options.logging, '║', '  ∞ ', `${Hints.record(this.record, this.method.member)} is subscribed to ${Hints.record(hint.record, hint.member)}${hint.times > 1 ? ` (${hint.times} times)` : ''}`)
    }
    return result || value.replacement === r
  }

  private static createMethodTrap(h: Handle, m: Member, options: OptionsImpl): F<any> {
    const method = new Method(h, m)
    const methodTrap: F<any> = (...args: any[]): any =>
      method.call(false, args).ret
    Utils.set(methodTrap, SYM_METHOD, method)
    return methodTrap
  }

  private static applyOptions(proto: any, m: Member, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<Options>, implicit: boolean): OptionsImpl {
    // Configure options
    const blank: any = Hooks.acquireMeta(proto, SYM_BLANK)
    const existing: CallResult | undefined = blank[m]
    const method = existing ? existing.method : new Method(NIL_HANDLE, m)
    const opts = existing ? existing.options : OptionsImpl.INITIAL
    const value =  new CallResult(method, NIL, new OptionsImpl(body, opts, options, implicit))
    blank[m] = value
    // Add to the list if it's a trigger
    if (value.options.kind === Kind.Trigger && value.options.throttling < Number.MAX_SAFE_INTEGER) {
      const triggers = Hooks.acquireMeta(proto, SYM_TRIGGERS)
      triggers[m] = value
    }
    else if (value.options.kind === Kind.Trigger && value.options.throttling < Number.MAX_SAFE_INTEGER) {
      const triggers = Hooks.getMeta<any>(proto, SYM_TRIGGERS)
      delete triggers[m]
    }
    return value.options
  }

  // static freeze(c: CachedResult): void {
  //   Utils.freezeMap(c.observables)
  //   Object.freeze(c)
  // }

  static init(): void {
    Dbg.getMergedLoggingOptions = getMergedLoggingOptions
    Snapshot.markViewed = CallResult.markViewed // override
    Snapshot.markChanged = CallResult.markChanged // override
    Snapshot.isConflicting = CallResult.isConflicting // override
    Snapshot.finalizeChangeset = CallResult.finalizeChangeset // override
    Hooks.createMethodTrap = CallResult.createMethodTrap // override
    Hooks.applyOptions = CallResult.applyOptions // override
    Promise.prototype.then = reactronicHookedThen // override
    try {
      Object.defineProperty(globalThis, 'rWhy', {
        get: Method.why, configurable: false, enumerable: false,
      })    }
    catch (e) {
      // ignore
    }
    try {
      Object.defineProperty(global, 'rWhy', {
        get: Method.why, configurable: false, enumerable: false,
      })    }
    catch (e) {
      // ignore
    }
  }
}

function propagationHint(cause: MemberHint): string[] {
  const result: string[] = []
  let value: Observable = cause.record.data[cause.member]
  while (value instanceof CallResult && value.invalidatedDueTo) {
    result.push(Hints.record(cause.record, cause.member))
    cause = value.invalidatedDueTo
    value = cause.record.data[cause.member]
  }
  result.push(Hints.record(cause.record, cause.member))
  result.push(cause.record.snapshot.hint)
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
  else if (value instanceof CallResult)
    result = `<recompute:${Hints.record(value.record.prev.record, undefined, true)}>`
  else if (value === SYM_UNMOUNT)
    result = '<unmount>'
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 20)
  else
    result = '◌'
  return result
}

function getMergedLoggingOptions(local: Partial<LoggingOptions> | undefined): LoggingOptions {
  const t = TransactionImpl.current
  let res = Dbg.merge(t.logging, t.id > 1 ? 31 + t.id % 6 : 37, t.id > 1 ? `T${t.id}` : `-${Snapshot.idGen.toString().replace(/[0-9]/g, '-')}`, Dbg.global)
  res = Dbg.merge({margin1: t.margin}, undefined, undefined, res)
  if (CallResult.current)
    res = Dbg.merge({margin2: CallResult.current.margin}, undefined, undefined, res)
  if (local)
    res = Dbg.merge(local, undefined, undefined, res)
  return res
}

const ORIGINAL_PROMISE_THEN = Promise.prototype.then

function reactronicHookedThen(this: any,
  resolve?: ((value: any) => any | PromiseLike<any>) | undefined | null,
  reject?: ((reason: any) => never | PromiseLike<never>) | undefined | null): Promise<any | never>
{
  const tran = TransactionImpl.current
  if (!tran.isFinished) {
    if (!resolve)
      resolve = resolveReturn
    if (!reject)
      reject = rejectRethrow
    const cache = CallResult.current
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

CallResult.init()
