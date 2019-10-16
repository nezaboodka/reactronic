// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F, Utils } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Record, FieldKey, Observable, FieldHint, Observer, Handle } from './Data'
import { Snapshot, Hints, INIT, SYM_HANDLE, SYM_METHOD, SYM_UNMOUNT, SYM_BLANK, SYM_TRIGGERS } from './Snapshot'
import { Transaction } from './Transaction'
import { MonitorImpl } from './MonitorImpl'
import { Hooks, OptionsImpl } from './Hooks'
import { Options, Kind, Reentrance, Trace } from '../Options'
import { Monitor, Worker } from '../Monitor'
import { Cache } from '../Cache'

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER
const NOTHING = new Handle(undefined, undefined, Hooks.proxy, INIT, 'nothing')

type Call = { context: Snapshot, record: Record, result: CachedResult, reusable: boolean }

export class ReactiveFunction extends Cache<any> {
  readonly handle: Handle
  readonly name: FieldKey

  setup(options: Partial<Options>): Options { return this.alterOptions(options) }
  get options(): Options { return this.weak().result.options }
  get args(): ReadonlyArray<any> { return this.weak().result.args }
  get value(): any { return this.call(true, undefined).result.value }
  get error(): boolean { return this.weak().result.error }
  get stamp(): number { return this.weak().record.snapshot.timestamp }
  get invalid(): boolean { return !this.weak().reusable }
  invalidate(): void { Transaction.run(Dbg.isOn ? `invalidate(${Hints.handle(this.handle, this.name)})` : 'invalidate()', ReactiveFunction.invalidate, this) }
  pullValue(args?: any[]): any { return this.call(true, args).result.value }

  constructor(handle: Handle, name: FieldKey) {
    super()
    this.handle = handle
    this.name = name
  }

  call(weak: boolean, args: any[] | undefined): Call {
    let call: Call = this.read(args)
    const ctx = call.context
    const c: CachedResult = call.result
    if (!call.reusable && (!weak || !c.invalid.renewing)) {
      const hint: string = Dbg.isOn ? `${Hints.handle(this.handle, this.name)}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? `/${args[0]}` : ''}` : /* istanbul ignore next */ 'Cache.run'
      const opt = c.options
      const spawn = weak || opt.kind === Kind.Trigger ||
        (opt.kind === Kind.Cached && call.record.snapshot !== call.context)
      const sidebyside = opt.reentrance === Reentrance.RunSideBySide
      const token = opt.kind === Kind.Cached ? this : undefined
      const call2 = this.compute(call, hint, spawn, sidebyside, opt.trace, token, args)
      const ctx2 = call2.result.record.snapshot
      if (!weak || ctx === ctx2 || (ctx2.applied && ctx.timestamp >= ctx2.timestamp))
        call = call2
    }
    else if (Dbg.isOn && Dbg.trace.methods && (c.options.trace === undefined || c.options.trace.methods === undefined || c.options.trace.methods === true)) Dbg.log(Transaction.current.isFinished ? '' : '║', ' (=)', `${Hints.record(call.record, this.name)} result is reused from T${call.result.worker.id} ${call.result.worker.hint}`)
    Snapshot.markViewed(call.record, this.name, call.result, weak)
    return call
  }

  static of(method: F<any>): Cache<any> {
    const func = Utils.get<Cache<any> | undefined>(method, SYM_METHOD)
    if (!func)
      throw misuse('given method is not a reactronic cache')
    return func
  }

  static runAs<T>(c: CachedResult | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined
    const outer = CachedResult.current
    try {
      CachedResult.current = c
      result = func(...args)
    }
    catch (e) {
      if (c)
        c.error = e
      throw e
    }
    finally {
      CachedResult.current = outer
    }
    return result
  }

  static unmount(...objects: any[]): Transaction {
    return Transaction.runEx('<unmount>', false, false,
      undefined, undefined, ReactiveFunction.doUnmount, ...objects)
  }

  // Internal

  private weak(): Call {
    const call = this.read(undefined)
    Snapshot.markViewed(call.record, this.name, call.result, true)
    return call
  }

  private read(args: any[] | undefined): Call {
    const ctx = Snapshot.readable()
    const r: Record = ctx.tryRead(this.handle)
    let c: CachedResult = r.data[this.name]
    if (c.record === INIT)
      c = this.initialize()
    const reusable = c.options.kind !== Kind.Action &&
      ((ctx === c.record.snapshot && c.invalid.since !== -1) || ctx.timestamp < c.invalid.since) &&
      (!c.options.cachedArgs || args === undefined || c.args.length === args.length && c.args.every((t, i) => t === args[i])) ||
      r.data[SYM_UNMOUNT] !== undefined
    return { context: ctx, record: r, result: c, reusable }
  }

  private write(): Call {
    const ctx = Snapshot.writable()
    const f = this.name
    const r: Record = ctx.write(this.handle, f, SYM_HANDLE, this)
    let c: CachedResult = r.data[f]
    if (c.record === INIT)
      c = this.initialize()
    if (c.record !== r) {
      const renewing = new CachedResult(this, r, c)
      r.data[f] = renewing
      renewing.error = ReactiveFunction.checkForReentrance(c)
      if (!renewing.error)
        c.invalid.renewing = renewing
      c = renewing
      ctx.bump(r.prev.record.snapshot.timestamp)
      Snapshot.markChanged(r, f, renewing, true)
    }
    return { context: ctx, record: r, result: c, reusable: true }
  }

  private initialize(): CachedResult {
    const name = this.name
    const hint: string = Dbg.isOn ? `${Hints.handle(this.handle, name)}/initialize` : /* istanbul ignore next */ 'Cache.init'
    const spawn: boolean = Snapshot.readable().read(this.handle).snapshot.applied
    return Transaction.runEx<CachedResult>(hint, spawn, false, undefined, this, (): CachedResult => {
      const h = this.handle
      let r: Record = Snapshot.readable().read(h)
      let c = r.data[name] as CachedResult
      if (c.record === INIT) {
        r = Snapshot.writable().write(h, name, SYM_HANDLE, this)
        c = r.data[name] = new CachedResult(this, r, c)
        c.invalid.since = -1 // indicates blank value
      }
      return c
    })
  }

  private static checkForReentrance(c: CachedResult): Error | undefined {
    let result: Error | undefined = undefined
    const prev = c.invalid.renewing
    const caller = Transaction.current
    if (prev && prev !== c && !prev.worker.isCanceled)
      switch (c.options.reentrance) {
        case Reentrance.PreventWithError:
          throw misuse(`${c.hint()} is not reentrant over ${prev.hint()}`)
        case Reentrance.WaitAndRestart:
          result = new Error(`T${caller.id} (${caller.hint}) will be restarted after T${prev.worker.id} (${prev.worker.hint})`)
          caller.cancel(result, prev.worker)
          // TODO: "c.invalid.renewing = caller" in order serialize all the actions
          break
        case Reentrance.CancelPrevious:
          prev.worker.cancel(new Error(`T${prev.worker.id} (${prev.worker.hint}) is canceled by T${caller.id} (${caller.hint}) and will be silently ignored`), null)
          c.invalid.renewing = undefined // allow
          break
        case Reentrance.RunSideBySide:
          break // do nothing
      }
    return result
  }

  private compute(existing: Call, hint: string, spawn: boolean, sidebyside: boolean, trace: Partial<Trace> | undefined, token: any, args: any[] | undefined): Call {
    // TODO: Cleaner implementation is needed
    let call = existing
    const ret = Transaction.runEx(hint, spawn, sidebyside, trace, token, (argsx: any[] | undefined): any => {
      if (Dbg.isOn && (Dbg.trace.transactions || Dbg.trace.methods || Dbg.trace.invalidations)) Dbg.log('║', ' (f)', `${Hints.record(existing.record, this.name)}${existing.result.invalid.hint ? `   <<   ${chainHint(existing.result.invalid.hint).join('   <<   ')}` : ''}`)
      if (!call.result.worker.isCanceled) { // first call
        call = this.write()
        call.result.compute(this.handle.proxy, argsx)
      }
      else { // retry call
        call = this.read(argsx) // re-read on retry
        if (call.result.options.kind === Kind.Action || (!call.reusable && !call.result.invalid.renewing)) {
          call = this.write()
          call.result.compute(this.handle.proxy, argsx)
        }
      }
      return call.result.ret
    }, args)
    call.result.ret = ret
    return call
  }

  private static invalidate(self: ReactiveFunction): void {
    const ctx = Snapshot.readable()
    const call = self.read(undefined)
    const c: CachedResult = call.result
    c.invalidateDueTo(c, {record: INIT, field: self.name, times: 0}, ctx.timestamp, ctx.triggers)
  }

  private alterOptions(options: Partial<Options>): Options {
    const call = this.read(undefined)
    const r: Record = call.record
    const hint: string = Dbg.isOn ? `setup(${Hints.handle(this.handle, this.name)})` : /* istanbul ignore next */ 'Cache.setup()'
    return Transaction.runEx(hint, false, false, undefined, undefined, (): Options => {
      const call2 = this.write()
      const c2: CachedResult = call2.result
      c2.options = new OptionsImpl(c2.options.body, c2.options, options, false)
      if (Dbg.isOn && Dbg.trace.writes) Dbg.log('║', '  ♦', `${Hints.record(r, this.name)}.options = ...`)
      return c2.options
    })
  }

  private static doUnmount(...objects: any[]): Transaction {
    for (const x of objects) {
      if (Utils.get<Handle>(x, SYM_HANDLE))
        x[SYM_UNMOUNT] = SYM_UNMOUNT
    }
    return Transaction.current
  }
}

// CachedResult

class CachedResult extends Observable implements Observer {
  static current?: CachedResult = undefined
  static asyncTriggerBatch: CachedResult[] = []

  readonly margin: number
  readonly method: ReactiveFunction
  readonly worker: Worker
  readonly record: Record
  readonly observables: Map<Observable, FieldHint>
  readonly invalid: { since: number, hint?: FieldHint, renewing?: CachedResult }

  options: OptionsImpl
  args: any[]
  ret: any
  error: any
  started: number

  constructor(method: ReactiveFunction, record: Record, init: CachedResult | OptionsImpl) {
    super(undefined)
    this.margin = CachedResult.current ? CachedResult.current.margin + 1 : 1
    this.method = method
    this.worker = Transaction.current
    this.record = record
    this.observables = new Map<Observable, FieldHint>()
    this.invalid = { since: 0, hint: undefined, renewing: undefined }
    if (init instanceof CachedResult) {
      this.options = init.options
      this.args = init.args
      // this.value = init.value
    }
    else { // init instanceof OptionsImpl
      this.options = init
      this.args = []
      // this.value = undefined
    }
    // this.ret = undefined
    // this.error = undefined
    this.started = 0
  }

  hint(): string { return `${Hints.record(this.record, this.method.name)}` }

  get isComputed(): boolean { return true }

  bind<T>(func: F<T>): F<T> {
    const cacheBound: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, '║', '‾\\', `${Hints.record(this.record, this.method.name)} - step in  `, 0, '        │')
      const result = ReactiveFunction.runAs<T>(this, func, ...args)
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, '║', '_/', `${Hints.record(this.record, this.method.name)} - step out `, 0, this.started > 0 ? '        │' : '')
      return result
    }
    return cacheBound
  }

  compute(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.invalid.since = TOP_TIMESTAMP
    if (!this.error)
      ReactiveFunction.runAs<void>(this, CachedResult.compute, this, proxy)
    else
      this.ret = Promise.reject(this.error)
  }

  invalidateDueTo(value: Observable, cause: FieldHint, since: number, triggers: Observer[]): void {
    if (this.invalid.since === TOP_TIMESTAMP || this.invalid.since <= 0) {
      const notSelfInvalidation = value.isComputed ||
        cause.record.snapshot !== this.record.snapshot ||
        !cause.record.changes.has(cause.field)
      if (notSelfInvalidation) {
        this.invalid.hint = cause
        this.invalid.since = since
        const isTrigger = this.options.kind === Kind.Trigger && this.record.data[SYM_UNMOUNT] === undefined
        if (Dbg.isOn && Dbg.trace.invalidations || (this.options.trace && this.options.trace.invalidations)) Dbg.logAs(this.options.trace, Dbg.trace.transactions && !Snapshot.readable().applied ? '║' : ' ', isTrigger ? '█' : '▒', isTrigger && cause.record === this.record && cause.field === this.method.name ? `${this.hint()} is a trigger and will run automatically` : `${this.hint()} is invalidated by ${Hints.record(cause.record, cause.field)} since v${since}${isTrigger ? ' and will run automatically' : ''}`)
        this.unsubscribeFromAll()
        if (isTrigger) // stop cascade invalidation on trigger
          triggers.push(this)
        else if (this.observers) // cascade invalidation
          this.observers.forEach(c => c.invalidateDueTo(this, {record: this.record, field: this.method.name, times: 0}, since, triggers))
        if (!this.worker.isFinished && this !== value)
          this.worker.cancel(new Error(`T${this.worker.id} (${this.worker.hint}) is canceled due to invalidation by ${Hints.record(cause.record, cause.field)}`), this.worker)
      }
      else if (Dbg.isOn && Dbg.trace.invalidations || (this.options.trace && this.options.trace.invalidations)) Dbg.logAs(this.options.trace, '║', 'x', `${this.hint()} invalidation is skipped`)
    }
  }

  recompute(now: boolean, nothrow: boolean): void {
    const delay = this.options.delay
    if (now || delay === -1) {
      if (!this.error && (this.options.kind === Kind.Action || !this.invalid.renewing)) {
        try {
          const call: Call = this.method.call(false, undefined)
          if (call.result.ret instanceof Promise)
            call.result.ret.catch(error => { /* nop */ }) // bad idea to hide an error
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
      setTimeout(() => this.recompute(true, true), delay)
  }

  // Internal

  private static compute(self: CachedResult, proxy: any): void {
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
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log('║', '‾\\', `${Hints.record(this.record, this.method.name)} - enter`)
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
      if (Dbg.isOn && Dbg.trace.methods) Dbg.log('║', '_/', `${Hints.record(this.record, this.method.name)} - leave... `, 0, 'ASYNC ──┐')
    }
    else {
      this.value = this.ret
      this.leave('_/', '- leave')
    }
  }

  private leave(op: string, message: string, highlight: string | undefined = undefined): void {
    const ms: number = Date.now() - this.started
    this.started = 0
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log('║', `${op}`, `${Hints.record(this.record, this.method.name)} ${message}`, ms, highlight)
    if (this.options.monitor)
      this.monitorLeave(this.options.monitor)
    // CacheResult.freeze(this)
  }

  private monitorEnter(mon: Monitor): void {
    ReactiveFunction.runAs<void>(undefined, Transaction.runEx, 'Monitor.enter',
      true, false, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
      MonitorImpl.enter, mon, this)
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.outside<void>(() => {
      const leave = (): void => {
        ReactiveFunction.runAs<void>(undefined, Transaction.runEx, 'Monitor.leave',
          true, false, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
          MonitorImpl.leave, mon, this)
      }
      this.worker.whenFinished().then(leave, leave)
    })
  }

  private addToAsyncTriggerBatch(): void {
    CachedResult.asyncTriggerBatch.push(this)
    if (CachedResult.asyncTriggerBatch.length === 1)
      setTimeout(CachedResult.processAsyncTriggerBatch, 0)
  }

  private static processAsyncTriggerBatch(): void {
    const triggers = CachedResult.asyncTriggerBatch
    CachedResult.asyncTriggerBatch = [] // reset
    for (const t of triggers)
      t.recompute(true, true)
  }

  private static markViewed(record: Record, field: FieldKey, value: Observable, weak: boolean): void {
    const c: CachedResult | undefined = CachedResult.current // alias
    if (c && c.options.kind !== Kind.Action && field !== SYM_HANDLE) {
      const ctx = Snapshot.readable()
      ctx.bump(record.snapshot.timestamp)
      const t = weak ? -1 : ctx.timestamp
      if (!c.subscribeTo(record, field, value, t))
        c.invalidateDueTo(value, {record, field, times: 0}, ctx.timestamp, ctx.triggers)
    }
  }

  private static markChanged(r: Record, field: FieldKey, value: any, changed: boolean): void {
    changed ? r.changes.add(field) : r.changes.delete(field)
    if (Dbg.isOn && Dbg.trace.writes) changed ? Dbg.log('║', '  ♦', `${Hints.record(r, field)} = ${valueHint(value)}`) : Dbg.log('║', '  ♦', `${Hints.record(r, field)} = ${valueHint(value)}`, undefined, ' (same as previous)')
  }

  private static propagateChanges(snapshot: Snapshot): void {
    const timestamp = snapshot.timestamp
    const triggers = snapshot.triggers
    // Mark previous values as replaced and invalidate existing observers
    snapshot.changeset.forEach((r: Record, h: Handle) => {
      if (!r.changes.has(SYM_UNMOUNT))
        r.changes.forEach(field =>
          CachedResult.markPrevValueAsReplaced(timestamp, r, field, triggers))
      else
        for (const field in r.prev.record.data)
          CachedResult.markPrevValueAsReplaced(timestamp, r, field, triggers)
    })
    // Subscribe to new observers and finish cache computations
    snapshot.changeset.forEach((r: Record, h: Handle) => {
      if (!r.changes.has(SYM_UNMOUNT))
        r.changes.forEach(field => CachedResult.finish(r, field, false))
      else
        for (const field in r.prev.record.data)
          CachedResult.finish(r, field, true)
    })
  }

  private static discardChanges(snapshot: Snapshot): void {
    snapshot.changeset.forEach((r: Record, h: Handle) =>
      r.changes.forEach(field => CachedResult.finish(r, field, true)))
  }

  private static markPrevValueAsReplaced(timestamp: number, record: Record, field: FieldKey, triggers: Observer[]): void {
    const prev = record.prev.record
    const value = prev.data[field] as Observable
    if (value !== undefined && value instanceof Observable && value.replacement === undefined) {
      value.replacement = record
      const hint: FieldHint = { record, field, times: 0 }
      if (value instanceof CachedResult && (value.invalid.since === TOP_TIMESTAMP || value.invalid.since <= 0)) {
        value.invalid.hint = hint
        value.invalid.since = timestamp
        value.unsubscribeFromAll()
      }
      if (value.observers)
        value.observers.forEach(c => c.invalidateDueTo(value, hint, timestamp, triggers))
    }
  }

  private finish(error?: any): void {
    const prev = this.record.prev.record.data[this.method.name]
    if (prev instanceof CachedResult) {
      // if (prev.record === INIT) {
      //   const h = Utils.get<Handle>(this.record.data, HANDLE)
      //   const func = Utils.get<ReactiveFunction>(h.proxy[this.field], FUNCTION)
      //   prev = func.initial
      // }
      if (prev.invalid.renewing === this)
        prev.invalid.renewing = undefined
    }
    if (Hooks.performanceWarningThreshold > 0) {
      this.observables.forEach((hint, value) => {
        if (hint.times > Hooks.performanceWarningThreshold) Dbg.log('', '[!]', `${this.hint()} uses ${Hints.record(hint.record, hint.field)} ${hint.times} times`, 0, ' *** WARNING ***')
      })
    }
  }

  private static finish(record: Record, field: FieldKey, cancel: boolean): void {
    const cache = record.data[field]
    if (cache instanceof CachedResult && cache.record === record) {
      if (cancel)
        cache.unsubscribeFromAll()
      cache.finish()
    }
  }

  private unsubscribeFromAll(): void {
    // It's critical to have on exceptions here
    this.observables.forEach((hint, value) => {
      const observers = value.observers
      if (observers)
        observers.delete(this) // now unsubscribed
      if ((Dbg.isOn && Dbg.trace.reads || (this.options.trace && this.options.trace.reads))) Dbg.logAs(this.options.trace, Dbg.trace.transactions && !Snapshot.readable().applied ? '║' : ' ', '-', `${Hints.record(this.record, this.method.name)} is unsubscribed from ${Hints.record(hint.record, hint.field, true)}`)
    })
    this.observables.clear() // now fully unlinked
  }

  private subscribeTo(record: Record, field: FieldKey, value: Observable, timestamp: number): boolean {
    let result = value.replacement === undefined
    if (result && timestamp !== -1)
      result = !(value instanceof CachedResult && timestamp >= value.invalid.since)
    if (result) {
      // Performance tracking
      let times: number = 0
      if (Hooks.performanceWarningThreshold > 0) {
        const existing = this.observables.get(value)
        times = existing ? existing.times + 1 : 1
      }
      // Acquire observers
      if (!value.observers)
        value.observers = new Set<CachedResult>()
      // Two-way linking
      const hint: FieldHint = {record, field, times}
      value.observers.add(this)
      this.observables.set(value, hint)
      if ((Dbg.isOn && Dbg.trace.reads || (this.options.trace && this.options.trace.reads))) Dbg.logAs(this.options.trace, '║', '  ∞ ', `${Hints.record(this.record, this.method.name)} is subscribed to ${Hints.record(hint.record, hint.field)}${hint.times > 1 ? ` (${hint.times} times)` : ''}`)
    }
    return result || value.replacement === record
  }

  private static createReactiveFunctionTrap(h: Handle, field: FieldKey, options: OptionsImpl): F<any> {
    const method = new ReactiveFunction(h, field)
    const methodTrap: F<any> = (...args: any[]): any =>
      method.call(false, args).result.ret
    Utils.set(methodTrap, SYM_METHOD, method)
    return methodTrap
  }

  private static alterBlank(proto: any, field: FieldKey, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<Options>, implicit: boolean): OptionsImpl {
    // Setup blank
    const blank: any = Hooks.acquireMeta(proto, SYM_BLANK)
    const existing: CachedResult | undefined = blank[field]
    const method = existing ? existing.method : new ReactiveFunction(NOTHING, field)
    const opts = existing ? existing.options : OptionsImpl.INITIAL
    const value =  new CachedResult(method, INIT, new OptionsImpl(body, opts, options, implicit))
    blank[field] = value
    // Add to the list if a trigger
    if (value.options.kind === Kind.Trigger && value.options.delay > -2) {
      const triggers = Hooks.acquireMeta(proto, SYM_TRIGGERS)
      triggers[field] = value
    }
    else if (value.options.kind === Kind.Trigger && value.options.delay > -2) {
      const triggers = Hooks.getMeta<any>(proto, SYM_TRIGGERS)
      delete triggers[field]
    }
    return value.options
  }

  private static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof CachedResult && oldValue.invalid.since !== -1
    return result
  }

  static freeze(c: CachedResult): void {
    Utils.freezeMap(c.observables)
    Object.freeze(c)
  }

  static init(): void {
    Dbg.getCurrentTrace = getCurrentTrace
    Snapshot.markViewed = CachedResult.markViewed // override
    Snapshot.markChanged = CachedResult.markChanged // override
    Snapshot.isConflicting = CachedResult.isConflicting // override
    Snapshot.propagateChanges = CachedResult.propagateChanges // override
    Snapshot.discardChanges = CachedResult.discardChanges // override
    Hooks.createReactiveFunctionTrap = CachedResult.createReactiveFunctionTrap // override
    Hooks.alterBlank = CachedResult.alterBlank // override
    Promise.prototype.then = fReactronicThen // override
  }
}

function chainHint(cause: FieldHint): string[] {
  const result: string[] = []
  let value: Observable = cause.record.data[cause.field]
  while (value instanceof CachedResult && value.invalid.hint) {
    result.push(Hints.record(cause.record, cause.field))
    cause = value.invalid.hint
    value = cause.record.data[cause.field]
  }
  result.push(Hints.record(cause.record, cause.field))
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
  else if (value instanceof CachedResult)
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
  let res = Dbg.merge(t.trace, t.id > 1 ? 31 + t.id % 6 : 37, t.id > 1 ? `T${t.id}` : `-${Snapshot.lastId.toString().replace(/[0-9]/g, '-')}`, Dbg.global)
  res = Dbg.merge({margin1: t.margin}, undefined, undefined, res)
  if (CachedResult.current)
    res = Dbg.merge({margin2: CachedResult.current.margin}, undefined, undefined, res)
  if (local)
    res = Dbg.merge(local, undefined, undefined, res)
  return res
}

const fOriginalPromiseThen = Promise.prototype.then

function fReactronicThen(this: any,
  resolve?: ((value: any) => any | PromiseLike<any>) | undefined | null,
  reject?: ((reason: any) => never | PromiseLike<never>) | undefined | null): Promise<any | never>
{
  const tran = Transaction.current
  if (!tran.isFinished) {
    if (!resolve)
      resolve = resolveReturn
    if (!reject)
      reject = rejectRethrow
    const cache = CachedResult.current
    if (cache) {
      resolve = cache.bind(resolve)
      reject = cache.bind(reject)
    }
    resolve = tran.bind(resolve, false)
    reject = tran.bind(reject, true)
  }
  return fOriginalPromiseThen.call(this, resolve, reject)
}

/* istanbul ignore next */
export function resolveReturn(value: any): any {
  return value
}

/* istanbul ignore next */
export function rejectRethrow(error: any): never {
  throw error
}

CachedResult.init()
