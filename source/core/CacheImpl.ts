// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg, misuse, Utils, F } from '../util/all'
import { Record, FieldKey, FieldValue, FieldHint, Observer, Handle, Snapshot, BLANK, Hint, OptionsImpl, Hooks, R_HANDLE, R_CACHE, R_UNMOUNT } from './all'
import { Cache } from '../Cache'
export { Cache, cacheof, resolved } from '../Cache'
import { Options, Kind, Reentrance, Trace } from '../Options'
import { Transaction } from '../Transaction'
import { Monitor } from '../Monitor'

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER
type CacheCall = { valid: boolean, cache: CacheResult, record: Record }

export class CacheImpl extends Cache<any> {
  private readonly handle: Handle
  private readonly blank: CacheResult

  setup(options: Partial<Options>): Options { return this.reconfigure(options) }
  get options(): Options { return this.weak().cache.options }
  get args(): ReadonlyArray<any> { return this.weak().cache.args }
  get value(): any { return this.tryCall(true).cache.value }
  get error(): boolean { return this.weak().cache.error }
  get stamp(): number { return this.weak().record.creator.timestamp }
  get invalid(): boolean { return !this.weak().valid }
  invalidate(): void { Transaction.run(Dbg.isOn ? `cacheof(${Hint.handle(this.handle, this.blank.field)}).invalidate` : "Cache.invalidate", CacheImpl.doInvalidate, this) }
  call(args?: any[]): any { return this.tryCall(true, args).cache.value }

  constructor(handle: Handle, field: FieldKey, options: OptionsImpl) {
    super()
    this.handle = handle
    this.blank = new CacheResult(BLANK, field, options)
    CacheResult.freeze(this.blank)
  }

  private initialize(): CacheResult {
    const hint: string = Dbg.isOn ? `${Hint.handle(this.handle)}.${this.blank.field.toString()}/init` : /* istanbul ignore next */ "Cache.init"
    const sidebyside = this.blank.options.reentrance === Reentrance.RunSideBySide
    const result = Transaction.runEx<CacheResult>(hint, true, sidebyside, this.blank.options.trace, this, (): CacheResult => {
      const c = this.write().cache
      c.ret = undefined
      c.value = undefined
      c.invalid.since = -1
      return c
    })
    this.blank.invalid.renewing = undefined
    return result
  }

  tryCall(weak: boolean, args?: any[]): CacheCall {
    let call: CacheCall = this.read(args)
    const c: CacheResult = call.cache
    if (!call.valid && (!weak || !c.invalid.renewing)) {
      const hint: string = Dbg.isOn ? `${Hint.handle(this.handle)}.${c.field.toString()}${args && args.length > 0 && args[0] instanceof Function === false ? `/${args[0]}` : ""}` : /* istanbul ignore next */ "Cache.run"
      const cfg = c.options
      const spawn = weak || cfg.kind !== Kind.Transaction
      const sidebyside = cfg.reentrance === Reentrance.RunSideBySide
      const token = cfg.kind === Kind.Cached ? this : undefined
      let call2 = call
      const ret = Transaction.runEx(hint, spawn, sidebyside, cfg.trace, token, (argsx: any[] | undefined): any => {
        // TODO: Cleaner implementation is needed
        if (call2.cache.tran.isCanceled()) {
          call2 = this.read(argsx) // re-read on retry
          if (!call2.valid) {
            call2 = this.write()
            call2.cache.compute(this.handle.proxy, argsx)
          }
        }
        else {
          call2 = this.write()
          call2.cache.compute(this.handle.proxy, argsx)
        }
        return call2.cache.ret
      }, args)
      call2.cache.ret = ret
      if (!weak && Snapshot.readable().timestamp >= call2.cache.record.creator.timestamp)
        call = call2
    }
    else if (Dbg.isOn && Dbg.trace.methods && (c.options.trace === undefined || c.options.trace.methods === undefined || c.options.trace.methods === true)) Dbg.log(Transaction.current.isFinished() ? "" : "║", "  ==", `${Hint.record(call.record)}.${call.cache.field.toString()} is reused (cached by T${call.cache.tran.id} ${call.cache.tran.hint})`)
    Snapshot.markViewed(call.record, call.cache.field, call.cache, weak)
    return call
  }

  private weak(): CacheCall {
    const call = this.read(undefined)
    Snapshot.markViewed(call.record, call.cache.field, call.cache, true)
    return call
  }

  private read(args: any[] | undefined): CacheCall {
    const ctx = Snapshot.readable()
    const r: Record = ctx.tryRead(this.handle)
    const c: CacheResult = r.data[this.blank.field] || this.initialize()
    const valid = c.options.kind !== Kind.Transaction &&
      (ctx === c.record.creator || ctx.timestamp < c.invalid.since) &&
      (!c.options.cachedArgs || args === undefined || c.args.length === args.length && c.args.every((t, i) => t === args[i])) ||
      r.data[R_UNMOUNT] !== undefined
    return { valid, cache: c, record: r }
  }

  private write(): CacheCall {
    const ctx = Snapshot.writable()
    const field = this.blank.field
    const r: Record = ctx.write(this.handle, field, R_HANDLE, this)
    let c: CacheResult = r.data[field] || this.blank
    if (c.record !== r) {
      const renewing = new CacheResult(r, field, c)
      r.data[field] = renewing
      renewing.error = CacheImpl.checkForReentrance(c)
      if (!renewing.error)
        c.invalid.renewing = renewing
      c = renewing
      ctx.bump(r.prev.record.creator.timestamp)
      Snapshot.markChanged(r, field, renewing, true)
    }
    return { valid: true, cache: c, record: r }
  }

  private static checkForReentrance(c: CacheResult): Error | undefined {
    let result: Error | undefined = undefined
    const prev = c.invalid.renewing
    const caller = Transaction.current
    if (prev && prev !== c && !prev.tran.isCanceled())
      switch (c.options.reentrance) {
        case Reentrance.PreventWithError:
          throw misuse(`${c.hint()} is not reentrant`)
        case Reentrance.WaitAndRestart:
          result = new Error(`transaction T${caller.id} (${caller.hint}) will be restarted after T${prev.tran.id} (${prev.tran.hint})`)
          caller.cancel(result, prev.tran)
          // TODO: "c.invalid.renewing = caller" in order serialize all the transactions
          break
        case Reentrance.CancelPrevious:
          prev.tran.cancel(new Error(`transaction T${prev.tran.id} (${prev.tran.hint}) is canceled by T${caller.id} (${caller.hint}) and will be silently ignored`), null)
          c.invalid.renewing = undefined // allow
          break
        case Reentrance.RunSideBySide:
          break // do nothing
      }
    return result
  }

  static doInvalidate(self: CacheImpl): void {
    const ctx = Snapshot.readable()
    const call = self.read(undefined)
    const c = call.cache
    c.invalidateDueTo(c, {record: BLANK, field: c.field, times: 0}, ctx.timestamp, ctx.triggers)
  }

  private reconfigure(options: Partial<Options>): Options {
    const call = this.read(undefined)
    const c: CacheResult = call.cache
    const r: Record = call.record
    const hint: string = Dbg.isOn ? `cacheof(${Hint.handle(this.handle)}.${this.blank.field.toString()}).setup()` : /* istanbul ignore next */ "Cache.setup()"
    return Transaction.runEx(hint, false, false, undefined, undefined, (): Options => {
      const call2 = this.write()
      const c2: CacheResult = call2.cache
      c2.options = new OptionsImpl(c2.options.body, c2.options, options, false)
      if (Dbg.isOn && Dbg.trace.writes) Dbg.log("║", "  w ", `${Hint.record(r)}.${c.field.toString()}.options = ...`)
      return c2.options
    })
  }

  static runAs<T>(c: CacheResult | undefined, func: F<T>, ...args: any[]): T {
    let result: T | undefined = undefined
    const outer = CacheResult.active
    try {
      CacheResult.active = c
      result = func(...args)
    }
    catch (e) {
      if (c)
        c.error = e
      throw e
    }
    finally {
      CacheResult.active = outer
    }
    return result
  }

  static createCacheTrap(h: Handle, field: FieldKey, options: OptionsImpl): F<any> {
    const cache = new CacheImpl(h, field, options)
    const cacheTrap: F<any> = (...args: any[]): any =>
      cache.tryCall(false, args).cache.ret
    Utils.set(cacheTrap, R_CACHE, cache)
    return cacheTrap
  }

  static of(method: F<any>): Cache<any> {
    const impl = Utils.get<Cache<any> | undefined>(method, R_CACHE)
    if (!impl)
      throw misuse("given method is not a reactronic cache")
    return impl
  }

  static unmount(...objects: any[]): Transaction {
    return Transaction.runEx("<unmount>", false, false,
      undefined, undefined, CacheImpl.unmountFunc, ...objects)
  }

  private static unmountFunc(...objects: any[]): Transaction {
    for (const x of objects) {
      if (Utils.get<Handle>(x, R_HANDLE))
        x[R_UNMOUNT] = R_UNMOUNT
    }
    return Transaction.current
  }
}

// CacheResult

class CacheResult extends FieldValue implements Observer {
  static asyncTriggerBatch: CacheResult[] = []
  static active?: CacheResult = undefined

  readonly tran: Transaction
  readonly record: Record
  readonly field: FieldKey
  options: OptionsImpl
  args: any[]
  ret: any
  error: any
  started: number
  readonly invalid: { since: number, renewing: CacheResult | undefined }
  readonly observables: Map<FieldValue, FieldHint>
  readonly weakObservables: Map<FieldValue, FieldHint>
  readonly margin: number

  constructor(record: Record, field: FieldKey, init: CacheResult | OptionsImpl) {
    super(undefined)
    this.tran = Transaction.current
    this.record = record
    this.field = field
    if (init instanceof CacheResult) {
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
    this.invalid = { since: 0, renewing: undefined }
    this.observables = new Map<FieldValue, FieldHint>()
    this.weakObservables = new Map<FieldValue, FieldHint>()
    this.margin = CacheResult.active ? CacheResult.active.margin + 1 : 1
  }

  hint(): string { return `${Hint.record(this.record, this.field)}` }

  get copyOnWriteMode(): boolean { return false }

  bind<T>(func: F<T>): F<T> {
    const fCacheRun: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, "║", "‾\\", `${Hint.record(this.record)}.${this.field.toString()} - step in  `, 0, "        │")
      const result = CacheImpl.runAs<T>(this, func, ...args)
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, "║", "_/", `${Hint.record(this.record)}.${this.field.toString()} - step out `, 0, this.started > 0 ? "        │" : "")
      return result
    }
    return fCacheRun
  }

  compute(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    if (!this.error)
      CacheImpl.runAs<void>(this, CacheResult.computeFunc, proxy, this)
    else
      this.ret = Promise.reject(this.error)
    this.invalid.since = TOP_TIMESTAMP
  }

  static computeFunc(proxy: any, c: CacheResult): void {
    c.enter()
    try {
      c.ret = c.options.body.call(proxy, ...c.args)
    }
    finally {
      c.leaveOrAsync()
    }
  }

  enter(): void {
    if (this.options.monitor)
      this.monitorEnter(this.options.monitor)
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "‾\\", `${Hint.record(this.record, this.field)} - enter`)
    this.started = Date.now()
  }

  leaveOrAsync(): void {
    if (this.ret instanceof Promise) {
      this.ret = this.ret.then(
        value => {
          this.value = value
          this.leave(" ▒", "- finished ", "   OK ──┘")
          return value
        },
        error => {
          this.error = error
          this.leave(" ▒", "- finished ", "  ERR ──┘")
          throw error
        })
      if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", "_/", `${Hint.record(this.record, this.field)} - leave... `, 0, "ASYNC ──┐")
    }
    else {
      this.value = this.ret
      this.leave("_/", "- leave")
    }
  }

  private leave(op: string, message: string, highlight: string | undefined = undefined): void {
    const ms: number = Date.now() - this.started
    this.started = 0
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log("║", `${op}`, `${Hint.record(this.record, this.field)} ${message}`, ms, highlight)
    if (this.options.monitor)
      this.monitorLeave(this.options.monitor)
    // CacheResult.freeze(this)
  }

  private monitorEnter(mon: Monitor): void {
    CacheImpl.runAs<void>(undefined, Transaction.runEx, "Monitor.enter",
      true, false, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
      Monitor.enter, mon, this)
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.outside<void>(() => {
      const leave = (): void => {
        CacheImpl.runAs<void>(undefined, Transaction.runEx, "Monitor.leave",
          true, false, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
          Monitor.leave, mon, this)
      }
      this.tran.whenFinished(false).then(leave, leave)
    })
  }

  finish(error?: any): void {
    const prev = this.record.prev.record.data[this.field]
    if (prev instanceof CacheResult && prev.invalid.renewing === this)
      prev.invalid.renewing = undefined
  }

  trig(timestamp: number, now: boolean, nothrow: boolean): void {
    const latency = this.options.latency
    if (now || latency === -1) {
      if (!this.error && (this.options.kind === Kind.Transaction ||
          (timestamp >= this.invalid.since && !this.invalid.renewing))) {
        try {
          const proxy: any = Utils.get<Handle>(this.record.data, R_HANDLE).proxy
          const trap: Function = Reflect.get(proxy, this.field, proxy)
          const cache = Utils.get<CacheImpl>(trap, R_CACHE)
          const call: CacheCall = cache.tryCall(false)
          if (call.cache.ret instanceof Promise)
            call.cache.ret.catch(error => { /* nop */ }) // bad idea to hide an error
        }
        catch (e) {
          if (!nothrow)
            throw e
        }
      }
    }
    else if (latency === 0)
      this.addToAsyncTriggerBatch()
    else if (latency > 0) // ignore disabled triggers (latency -2)
      setTimeout(() => this.trig(TOP_TIMESTAMP, true, true), latency)
  }

  private addToAsyncTriggerBatch(): void {
    CacheResult.asyncTriggerBatch.push(this)
    if (CacheResult.asyncTriggerBatch.length === 1)
      setTimeout(CacheResult.processAsyncTriggerBatch, 0)
  }

  private static processAsyncTriggerBatch(): void {
    const triggers = CacheResult.asyncTriggerBatch
    CacheResult.asyncTriggerBatch = [] // reset
    for (const t of triggers)
      t.trig(TOP_TIMESTAMP, true, true)
  }

  private static markViewed(record: Record, field: FieldKey, value: FieldValue, weak: boolean): void {
    const c: CacheResult | undefined = CacheResult.active // alias
    if (c && c.options.kind !== Kind.Transaction && field !== R_HANDLE) {
      const ctx = Snapshot.readable()
      ctx.bump(record.creator.timestamp)
      if (!c.subscribeToFieldValue(weak, record, field, value, ctx.timestamp))
        c.invalidateDueTo(value, {record, field, times: 0}, ctx.timestamp, ctx.triggers)
    }
  }

  private static markChanged(r: Record, field: FieldKey, value: any, changed: boolean): void {
    changed ? r.changes.add(field) : r.changes.delete(field)
    if (Dbg.isOn && Dbg.trace.writes) changed ? Dbg.log("║", "  w ", `${Hint.record(r, field)} = ${valueHint(value)}`) : Dbg.log("║", "  w ", `${Hint.record(r, field)} = ${valueHint(value)}`, undefined, " (same as previous)")
  }

  private static applyAllDependencies(snapshot: Snapshot, error?: any): void {
    const timestamp = snapshot.timestamp
    if (error === undefined) {
      const triggers = snapshot.triggers
      // Mark previous values as replaced and invalidate existing observers
      snapshot.changeset.forEach((r: Record, h: Handle) => {
        if (!r.changes.has(R_UNMOUNT))
          r.changes.forEach(field =>
            CacheResult.markPrevValueAsReplaced(timestamp, r, field, triggers))
        else
          for (const field in r.prev.record.data)
            CacheResult.markPrevValueAsReplaced(timestamp, r, field, triggers)
      })
      // Subscribe to new observers and finish cache computations
      snapshot.changeset.forEach((r: Record, h: Handle) => {
        if (!r.changes.has(R_UNMOUNT))
          r.changes.forEach(field => CacheResult.finish(r, field, false))
        else
          for (const field in r.prev.record.data)
            CacheResult.finish(r, field, true)
      })
    }
    else
      snapshot.changeset.forEach((r: Record, h: Handle) =>
        r.changes.forEach(field => CacheResult.finish(r, field, true)))
  }

  private static markPrevValueAsReplaced(timestamp: number, record: Record, field: FieldKey, triggers: Observer[]): void {
    const prev = record.prev.record
    const value = prev.data[field] as FieldValue
    if (value !== undefined && value.replacement === undefined) {
      value.replacement = record
      if (value instanceof CacheResult && (value.invalid.since === TOP_TIMESTAMP || value.invalid.since <= 0)) {
        value.invalid.since = timestamp
        value.unsubscribeFromAllObservables()
      }
      if (value.observers)
        value.observers.forEach(c => c.invalidateDueTo(value, { record, field: field, times: 0 }, timestamp, triggers))
    }
  }

  private static finish(record: Record, field: FieldKey, cancel: boolean): void {
    const cache = record.data[field]
    if (cache instanceof CacheResult && cache.record === record) {
      if (cancel)
        cache.unsubscribeFromAllObservables()
      cache.finish()
    }
  }

  private unsubscribeFromAllObservables(): void {
    this.unsubscribeFrom(this.observables)
    this.unsubscribeFrom(this.weakObservables)
  }

  private unsubscribeFrom(observables: Map<FieldValue, FieldHint>): void {
    // It's critical to have on exceptions here
    observables.forEach((hint, value) => {
      const observers = value.observers
      if (observers)
        observers.delete(this) // now unsubscribed
      if ((Dbg.isOn && Dbg.trace.subscriptions || (this.options.trace && this.options.trace.subscriptions))) Dbg.logAs(this.options.trace, " ", "  - ", `${Hint.record(this.record, this.field)} is unsubscribed from ${Hint.record(hint.record, hint.field, true)}.`)
    })
    observables.clear()
  }

  private subscribeToFieldValue(weak: boolean, record: Record, field: FieldKey, value: FieldValue, timestamp: number): boolean {
    let result = value.replacement === undefined
    if (result && timestamp !== -1)
      result = !(value instanceof CacheResult && timestamp >= value.invalid.since)
    if (result) {
      // Observables
      const observables = this.getObservables(weak)
      let times: number = 0
      if (Hooks.performanceWarningThreshold > 0) {
        const existing = observables.get(value)
        times = existing ? existing.times + 1 : 1
      }
      // Observers
      if (!value.observers) // acquire
        value.observers = new Set<CacheResult>()
      // Two-way linking
      const hint: FieldHint = {record, field: field, times}
      value.observers.add(this)
      observables.set(value, hint)
      // if (Dbg.isOn && Dbg.trace.reads) Dbg.log("║", `  r `, `${c.hint()} ${weak ? 'uses (weakly)' : 'uses'} ${Hint.record(record, field)} - ${times} time(s)`)
      if ((Dbg.isOn && Dbg.trace.subscriptions || (this.options.trace && this.options.trace.subscriptions))) Dbg.logAs(this.options.trace, " ", "  o ", `${Hint.record(this.record, this.field)} is subscribed to ${Hint.record(hint.record, hint.field, true)}${hint.times > 1 ? ` (${hint.times} times)` : ""}.`)
      if (hint.times > Hooks.performanceWarningThreshold) Dbg.log("≡", "!", `${this.hint()} uses ${Hint.record(hint.record, hint.field)} ${hint.times} time(s).`, 0, " *** WARNING ***")
    }
    return result || value.replacement === record
  }

  getObservables(weak: boolean): Map<FieldValue, FieldHint> {
    return weak ? this.weakObservables : this.observables
  }

  invalidateDueTo(cause: FieldValue, hint: FieldHint, since: number, triggers: Observer[]): boolean {
    const result = this.record !== hint.record &&
      (this.invalid.since === TOP_TIMESTAMP || this.invalid.since <= 0)
    if (result) {
      this.invalid.since = since
      const isTrigger = this.options.kind === Kind.Trigger && this.record.data[R_UNMOUNT] === undefined
      if (Dbg.isOn && Dbg.trace.invalidations || (this.options.trace && this.options.trace.invalidations)) Dbg.logAs(this.options.trace, " ", isTrigger ? "  ■ " : "  □ ", isTrigger && hint.record === this.record && hint.field === this.field ? `${this.hint()} is a trigger and will run automatically` : `${this.hint()} is invalidated due to ${Hint.record(hint.record, hint.field)} since v${since}${isTrigger ? " and will run automatically" : ""}`)
      this.unsubscribeFromAllObservables()
      if (!this.tran.isFinished())
        this.tran.cancel(new Error(`transaction T${this.tran.id} (${this.tran.hint}) is canceled due to invalidation by ${Hint.record(hint.record, hint.field)} and will be silently ignored`), null)
      if (isTrigger) // stop cascade invalidation on trigger
        triggers.push(this)
      else if (this.observers) // cascade invalidation
        this.observers.forEach(c => c.invalidateDueTo(this, {record: this.record, field: this.field, times: 0}, since, triggers))
    }
    return result
  }

  static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof CacheResult && oldValue.invalid.since !== -1
    return result
  }

  static freeze(c: CacheResult): void {
    Utils.freezeMap(c.observables)
    Utils.freezeMap(c.weakObservables)
    Object.freeze(c)
  }

  static init(): void {
    Dbg.getCurrentTrace = getCurrentTrace
    Snapshot.markViewed = CacheResult.markViewed // override
    Snapshot.markChanged = CacheResult.markChanged // override
    Snapshot.isConflicting = CacheResult.isConflicting // override
    Snapshot.applyAllDependencies = CacheResult.applyAllDependencies // override
    Hooks.createCacheTrap = CacheImpl.createCacheTrap // override
    Promise.prototype.then = fReactronicThen // override
  }
}

function valueHint(value: any): string {
  let result: string = ""
  if (Array.isArray(value))
    result = `Array(${value.length})`
  else if (value instanceof Set)
    result = `Set(${value.size})`
  else if (value instanceof Map)
    result = `Map(${value.size})`
  else if (value instanceof CacheResult)
    result = `<renew:${Hint.record(value.record.prev.record, undefined, true)}>`
  else if (value === R_UNMOUNT)
    result = "<unmount>"
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 20)
  else
    result = "◌"
  return result
}

function getCurrentTrace(local: Partial<Trace> | undefined): Trace {
  const t = Transaction.current
  let res = Dbg.merge(t.trace, t.id > 1 ? 31 + t.id % 6 : 37, t.id > 1 ? `T${t.id}` : "", Dbg.global)
  res = Dbg.merge({margin1: t.margin}, undefined, undefined, res)
  if (CacheResult.active)
    res = Dbg.merge({margin2: CacheResult.active.margin}, undefined, undefined, res)
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
  if (!tran.isFinished()) {
    if (!resolve)
      resolve = resolveReturn
    if (!reject)
      reject = rejectRethrow
    const cache = CacheResult.active
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

CacheResult.init()
