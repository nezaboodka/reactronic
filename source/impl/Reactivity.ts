// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F, Utils } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Record, Member, Observable, MemberHint, Observer } from './Data'
import { Snapshot, RObject, Hints, NIL, SYM_OBJECT, SYM_METHOD, SYM_UNMOUNT, SYM_BLANK, SYM_TRIGGERS } from './Snapshot'
import { Transaction } from './Transaction'
import { MonitorImpl } from './MonitorImpl'
import { Hooks, OptionsImpl } from './Hooks'
import { Options, Kind, Reentrance, Trace } from '../Options'
import { Monitor, Worker } from '../Monitor'
import { Cache } from '../Cache'

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER
const NIL_INSTANCE = new RObject(undefined, undefined, Hooks.proxy, NIL, 'nil')

type Call = { context: Snapshot, record: Record, result: CallResult, reuse: boolean }

export class Method extends Cache<any> {
  readonly instance: RObject
  readonly member: Member

  setup(options: Partial<Options>): Options { return Method.setup(this, options) }
  get options(): Options { return this.weak().result.options }
  get args(): ReadonlyArray<any> { return this.weak().result.args }
  get value(): any { return this.call(true, undefined).value }
  get error(): boolean { return this.weak().result.error }
  get stamp(): number { return this.weak().record.snapshot.timestamp }
  get invalid(): boolean { return !this.weak().reuse }
  invalidate(): void { Transaction.run(Dbg.isOn ? `invalidate(${Hints.obj(this.instance, this.member)})` : 'invalidate()', Method.invalidate, this) }
  getCachedAndRevalidate(args?: any[]): any { return this.call(true, args).value }

  constructor(instance: RObject, member: Member) {
    super()
    this.instance = instance
    this.member = member
  }

  call(weak: boolean, args: any[] | undefined): CallResult {
    let call: Call = this.read(args)
    const ctx = call.context
    const c: CallResult = call.result
    if (!call.reuse && call.record.data[SYM_UNMOUNT] === undefined && (!weak || !c.invalid.recomputing)) {
      const opt = c.options
      const spawn = weak || opt.kind === Kind.Trigger ||
        (opt.kind === Kind.Cached && (call.record.snapshot.completed || call.record.prev.record !== NIL))
      const token = opt.kind === Kind.Cached ? this : undefined
      const call2 = this.compute(call, spawn, opt.trace, token, args)
      const ctx2 = call2.result.record.snapshot
      if (!weak || ctx === ctx2 || (ctx2.completed && ctx.timestamp >= ctx2.timestamp))
        call = call2
    }
    else if (Dbg.isOn && Dbg.trace.methods && (c.options.trace === undefined || c.options.trace.methods === undefined || c.options.trace.methods === true)) Dbg.log(Transaction.current.isFinished ? '' : '║', ' (=)', `${Hints.record(call.record, this.member)} result is reused from T${call.result.worker.id} ${call.result.worker.hint}`)
    const result = call.result
    Snapshot.markViewed(call.record, this.member, result, result.options.kind, weak)
    return result
  }

  static of(method: F<any>): Cache<any> {
    const func = Utils.get<Cache<any> | undefined>(method, SYM_METHOD)
    if (!func)
      throw misuse('given method is not a reactronic cache')
    return func
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

  static unmount(...objects: any[]): void {
    return Transaction.runAs('<unmount>', false,
      undefined, undefined, Snapshot.unmount, ...objects)
  }

  static why(): string {
    const c = CallResult.current
    return c ? c.why() : 'because'
  }

  // Internal

  private weak(): Call {
    const call = this.read(undefined)
    Snapshot.markViewed(call.record, this.member, call.result, call.result.options.kind, true)
    return call
  }

  private read(args: any[] | undefined): Call {
    const ctx = Snapshot.readable()
    const r: Record = ctx.tryRead(this.instance)
    const c: CallResult = this.from(r)
    const reuse = c.options.kind !== Kind.Action &&
      ((ctx === c.record.snapshot && c.invalid.since !== -1) || ctx.timestamp < c.invalid.since) &&
      (!c.options.urgingArgs || args === undefined || c.args.length === args.length && c.args.every((t, i) => t === args[i])) ||
      r.data[SYM_UNMOUNT] !== undefined
    return { context: ctx, record: r, result: c, reuse }
  }

  private write(): Call {
    const ctx = Snapshot.writable()
    const m = this.member
    const r: Record = ctx.write(this.instance, m, SYM_OBJECT, this)
    let c: CallResult = this.from(r)
    if (c.record !== r) {
      const c2 = new CallResult(this, r, c)
      c = r.data[m] = c2.reenterOver(c)
      ctx.bump(r.prev.record.snapshot.timestamp)
      Snapshot.markChanged(r, m, c, true)
    }
    return { context: ctx, record: r, result: c, reuse: true }
  }

  private from(r: Record): CallResult {
    const m = this.member
    let c: CallResult = r.data[m]
    if (c.method !== this) {
      const hint: string = Dbg.isOn ? `${Hints.obj(this.instance, m)}/initialize` : /* istanbul ignore next */ 'Cache.init'
      const spawn = r.snapshot.completed || r.prev.record !== NIL
      c = Transaction.runAs<CallResult>(hint, spawn, undefined, this, (): CallResult => {
        const o = this.instance
        let r2: Record = Snapshot.readable().read(o)
        let c2 = r2.data[m] as CallResult
        if (c2.method !== this) {
          r2 = Snapshot.writable().write(o, m, SYM_OBJECT, this)
          c2 = r2.data[m] = new CallResult(this, r2, c2)
          c2.invalid.since = -1 // indicates blank value
          Snapshot.markChanged(r2, m, c2, true)
        }
        return c2
      })
    }
    return c
  }

  private compute(existing: Call, spawn: boolean, trace: Partial<Trace> | undefined, token: any, args: any[] | undefined): Call {
    // TODO: Cleaner implementation is needed
    const hint: string = Dbg.isOn ? `${Hints.obj(this.instance, this.member)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? `/${args[0]}` : ''}` : /* istanbul ignore next */ `${Hints.obj(this.instance, this.member)}`
    let call = existing
    const ret = Transaction.runAs(hint, spawn, trace, token, (argsx: any[] | undefined): any => {
      if (!call.result.worker.isCanceled) { // first call
        call = this.write()
        if (Dbg.isOn && (Dbg.trace.transactions || Dbg.trace.methods || Dbg.trace.invalidations)) Dbg.log('║', ' (f)', `${call.result.why()}`)
        call.result.compute(this.instance.proxy, argsx)
      }
      else { // retry call
        call = this.read(argsx) // re-read on retry
        if (call.result.options.kind === Kind.Action || (!call.reuse && !call.result.invalid.recomputing)) {
          call = this.write()
          if (Dbg.isOn && (Dbg.trace.transactions || Dbg.trace.methods || Dbg.trace.invalidations)) Dbg.log('║', ' (f)', `${call.result.why()}`)
          call.result.compute(this.instance.proxy, argsx)
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

  private static setup(self: Method, options: Partial<Options>): Options {
    const call = self.read(undefined)
    const r: Record = call.record
    const hint: string = Dbg.isOn ? `setup(${Hints.obj(self.instance, self.member)})` : /* istanbul ignore next */ 'Cache.setup()'
    return Transaction.runAs(hint, false, undefined, undefined, (): Options => {
      const call2 = self.write()
      const c2: CallResult = call2.result
      c2.options = new OptionsImpl(c2.options.body, c2.options, options, false)
      if (Dbg.isOn && Dbg.trace.writes) Dbg.log('║', '  ♦', `${Hints.record(r, self.member)}.options = ...`)
      return c2.options
    })
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
  readonly invalid: { since: number, cause?: MemberHint, recomputing?: CallResult }
  options: OptionsImpl
  cause: MemberHint | undefined
  args: any[]
  ret: any
  error: any
  readonly margin: number
  readonly worker: Worker
  started: number

  constructor(method: Method, record: Record, prev: CallResult | OptionsImpl) {
    super(undefined)
    this.method = method
    this.record = record
    this.observables = new Map<Observable, MemberHint>()
    this.invalid = { since: 0, cause: undefined, recomputing: undefined }
    if (prev instanceof CallResult) {
      this.options = prev.options
      this.args = prev.args
      // this.value = init.value
      this.cause = prev.invalid.cause
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
    this.worker = Transaction.current
    this.started = 0
  }

  hint(): string { return `${Hints.record(this.record, this.method.member)}` }
  priority(): number { return this.options.priority }
  why(): string { return `${Hints.record(this.record, this.method.member)}${this.cause ? `   <<   ${propagationHint(this.cause).join('   <<   ')}` : '   <<   first on-demand call'}` }

  bind<T>(func: F<T>): F<T> {
    const cacheBound: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, '║', '‾\\', `${Hints.record(this.record, this.method.member)} - step in  `, 0, '        │')
      const result = Method.run<T>(this, func, ...args)
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, '║', '_/', `${Hints.record(this.record, this.method.member)} - step out `, 0, this.started > 0 ? '        │' : '')
      return result
    }
    return cacheBound
  }

  compute(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.invalid.since = TOP_TIMESTAMP
    if (!this.error)
      Method.run<void>(this, CallResult.compute, this, proxy)
    else
      this.ret = Promise.reject(this.error)
  }

  invalidateDueTo(value: Observable, cause: MemberHint, since: number, triggers: Observer[]): void {
    if (this.invalid.since === TOP_TIMESTAMP || this.invalid.since <= 0) {
      const notSelfInvalidation = !value.isField ||
        cause.record.snapshot !== this.record.snapshot ||
        !cause.record.changes.has(cause.member)
      if (notSelfInvalidation) {
        this.invalid.cause = cause
        this.invalid.since = since
        const isTrigger = this.options.kind === Kind.Trigger /*&& this.record.data[SYM_UNMOUNT] === undefined*/
        if (Dbg.isOn && Dbg.trace.invalidations || (this.options.trace && this.options.trace.invalidations)) Dbg.logAs(this.options.trace, Dbg.trace.transactions && !Snapshot.readable().completed ? '║' : ' ', isTrigger ? '█' : '▒', isTrigger && cause.record === NIL ? `${this.hint()} is a trigger and will run automatically (priority ${this.options.priority})` : `${this.hint()} is invalidated by ${Hints.record(cause.record, cause.member)} since v${since}${isTrigger ? ` and will run automatically (priority ${this.options.priority})` : ''}`)
        this.unsubscribeFromAll()
        if (isTrigger) // stop cascade invalidation on trigger
          triggers.push(this)
        else if (this.observers) // cascade invalidation
          this.observers.forEach(c => c.invalidateDueTo(this, {record: this.record, member: this.method.member, times: 0}, since, triggers))
        if (!this.worker.isFinished && this !== value)
          this.worker.cancel(new Error(`T${this.worker.id} (${this.worker.hint}) is canceled due to invalidation by ${Hints.record(cause.record, cause.member)}`), this.worker)
      }
      else if (Dbg.isOn && Dbg.trace.invalidations || (this.options.trace && this.options.trace.invalidations)) Dbg.logAs(this.options.trace, '║', 'x', `${this.hint()} self-invalidation is skipped`)
    }
  }

  revalidate(now: boolean, nothrow: boolean): void {
    const delay = this.options.delay
    if (now || delay === -1) {
      if (!this.error && (this.options.kind === Kind.Action || !this.invalid.recomputing)) {
        try {
          const c: CallResult = this.method.call(false, undefined)
          if (c.ret instanceof Promise)
            c.ret.catch(error => { /* nop */ }) // bad idea to hide an error
        }
        catch (e) {
          if (!nothrow)
            throw e
        }
      }
    }
    else if (delay === 0)
      this.addToAsyncTriggerBatch()
    else if (delay > 0) // ignore disabled triggers (delay -2)
      setTimeout(() => this.revalidate(true, true), delay)
  }

  reenterOver(head: CallResult): this {
    let error: Error | undefined = undefined
    const rival = head.invalid.recomputing
    if (rival && rival !== this && !rival.worker.isCanceled) {
      switch (head.options.reentrance) {
        case Reentrance.PreventWithError:
          throw misuse(`${head.hint()} (${head.why()}) is not reentrant over ${rival.hint()} (${rival.why()})`)
        case Reentrance.WaitAndRestart:
          error = new Error(`T${this.worker.id} (${this.worker.hint}) will be restarted after T${rival.worker.id} (${rival.worker.hint})`)
          this.worker.cancel(error, rival.worker)
          // TODO: "c.invalid.recomputing = caller" in order serialize all the actions
          break
        case Reentrance.CancelPrevious:
          rival.worker.cancel(new Error(`T${rival.worker.id} (${rival.worker.hint}) is canceled by T${this.worker.id} (${this.worker.hint}) and will be silently ignored`), null)
          head.invalid.recomputing = undefined // allow
          break
        case Reentrance.RunSideBySide:
          break // do nothing
      }
    }
    if (!error)
      head.invalid.recomputing = this
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
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log('║', '‾\\', `${Hints.record(this.record, this.method.member)} - enter`)
    this.started = Date.now()
  }

  private leaveOrAsync(): void {
    if (this.ret instanceof Promise) {
      this.ret = this.ret.then(
        value => {
          this.value = value
          this.leave('  □ ', '- finished ', ' OK ──┘')
          return value
        },
        error => {
          this.error = error
          this.leave('  □ ', '- finished ', 'ERR ──┘')
          throw error
        })
      if (Dbg.isOn && Dbg.trace.methods) Dbg.log('║', '_/', `${Hints.record(this.record, this.method.member)} - leave... `, 0, 'ASYNC ──┐')
    }
    else {
      this.value = this.ret
      this.leave('_/', '- leave')
    }
  }

  private leave(op: string, message: string, highlight: string | undefined = undefined): void {
    const ms: number = Date.now() - this.started
    this.started = 0
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log('║', `${op}`, `${Hints.record(this.record, this.method.member)} ${message}`, ms, highlight)
    if (Hooks.performanceWarningThreshold > 0 && ms > Hooks.performanceWarningThreshold) Dbg.log('', '[!]', this.why(), ms, '    *** took too long ***')
    if (this.options.monitor)
      this.monitorLeave(this.options.monitor)
    // CachedResult.freeze(this)
  }

  private monitorEnter(mon: Monitor): void {
    Method.run<void>(undefined, Transaction.runAs, 'Monitor.enter',
      true, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
      MonitorImpl.enter, mon, this.worker)
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.isolated<void>(() => {
      const leave = (): void => {
        Method.run<void>(undefined, Transaction.runAs, 'Monitor.leave',
          true, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.OFF, undefined,
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
    const c: CallResult | undefined = CallResult.current // alias
    if (kind !== Kind.Action && c && c.options.kind !== Kind.Action && m !== SYM_OBJECT) {
      const ctx = Snapshot.readable()
      ctx.bump(r.snapshot.timestamp)
      const t = weak ? -1 : ctx.timestamp
      if (!c.subscribeTo(r, m, value, t))
        c.invalidateDueTo(value, {record: r, member: m, times: 0}, ctx.timestamp, ctx.triggers)
    }
  }

  private static markChanged(r: Record, m: Member, value: any, changed: boolean): void {
    changed ? r.changes.add(m) : r.changes.delete(m)
    if (Dbg.isOn && Dbg.trace.writes) changed ? Dbg.log('║', '  ♦', `${Hints.record(r, m)} = ${valueHint(value)}`) : Dbg.log('║', '  ♦', `${Hints.record(r, m)} = ${valueHint(value)}`, undefined, ' (same as previous)')
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof CallResult && oldValue.invalid.since !== -1
    return result
  }

  private static finalizeChangeset(snapshot: Snapshot, error: Error | undefined): void {
    const since = snapshot.timestamp
    if (!error) {
      // Mark previous values as replaced, invalidate observers, and reset recomputing status
      const triggers = snapshot.triggers
      snapshot.changeset.forEach((r: Record, o: RObject) => {
        if (!r.changes.has(SYM_UNMOUNT))
          r.changes.forEach(m => CallResult.finalizeChange(false, since, r, m, triggers))
        else
          for (const m in r.prev.record.data)
            CallResult.finalizeChange(true, since, r, m, triggers)
      })
      triggers.sort(CallResult.compareTriggersByPriority)
    }
    else {
      snapshot.changeset.forEach((r: Record, o: RObject) =>
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
        if (prev instanceof CallResult && (prev.invalid.since === TOP_TIMESTAMP || prev.invalid.since <= 0)) {
          prev.invalid.cause = cause
          prev.invalid.since = timestamp
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
      const prev = cache.record.prev.record.data[m]
      if (prev instanceof CallResult && prev.invalid.recomputing === cache)
        prev.invalid.recomputing = undefined
      // Performance tracking
      if (Hooks.repetitiveReadWarningThreshold > 0) {
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
      if ((Dbg.isOn && Dbg.trace.reads || (this.options.trace && this.options.trace.reads))) Dbg.logAs(this.options.trace, Dbg.trace.transactions && !Snapshot.readable().completed ? '║' : ' ', '-', `${Hints.record(this.record, this.method.member)} is unsubscribed from ${Hints.record(hint.record, hint.member, true)}`)
    })
    this.observables.clear()
  }

  private subscribeTo(r: Record, m: Member, value: Observable, timestamp: number): boolean {
    let result = value.replacement === undefined
    if (result && timestamp !== -1)
      result = !(value instanceof CallResult && timestamp >= value.invalid.since)
    if (result) {
      // Performance tracking
      let times: number = 0
      if (Hooks.repetitiveReadWarningThreshold > 0) {
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
      if ((Dbg.isOn && Dbg.trace.reads || (this.options.trace && this.options.trace.reads))) Dbg.logAs(this.options.trace, '║', '  ∞ ', `${Hints.record(this.record, this.method.member)} is subscribed to ${Hints.record(hint.record, hint.member)}${hint.times > 1 ? ` (${hint.times} times)` : ''}`)
    }
    return result || value.replacement === r
  }

  private static createMethodTrap(o: RObject, m: Member, options: OptionsImpl): F<any> {
    const method = new Method(o, m)
    const methodTrap: F<any> = (...args: any[]): any =>
      method.call(false, args).ret
    Utils.set(methodTrap, SYM_METHOD, method)
    return methodTrap
  }

  private static applyOptions(proto: any, m: Member, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<Options>, implicit: boolean): OptionsImpl {
    // Setup options
    const blank: any = Hooks.acquireMeta(proto, SYM_BLANK)
    const existing: CallResult | undefined = blank[m]
    const method = existing ? existing.method : new Method(NIL_INSTANCE, m)
    const opts = existing ? existing.options : OptionsImpl.INITIAL
    const value =  new CallResult(method, NIL, new OptionsImpl(body, opts, options, implicit))
    blank[m] = value
    // Add to the list if it's a trigger
    if (value.options.kind === Kind.Trigger && value.options.delay > -2) {
      const triggers = Hooks.acquireMeta(proto, SYM_TRIGGERS)
      triggers[m] = value
    }
    else if (value.options.kind === Kind.Trigger && value.options.delay > -2) {
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
    Dbg.getCurrentTrace = getCurrentTrace
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
  while (value instanceof CallResult && value.invalid.cause) {
    result.push(Hints.record(cause.record, cause.member))
    cause = value.invalid.cause
    value = cause.record.data[cause.member]
  }
  result.push(Hints.record(cause.record, cause.member))
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

function getCurrentTrace(local: Partial<Trace> | undefined): Trace {
  const t = Transaction.current
  let res = Dbg.merge(t.trace, t.id > 1 ? 31 + t.id % 6 : 37, t.id > 1 ? `T${t.id}` : `-${Snapshot.idGen.toString().replace(/[0-9]/g, '-')}`, Dbg.global)
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
  const tran = Transaction.current
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
