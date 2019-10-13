// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F, Utils } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Record, FieldKey, Observable, FieldHint, Observer, Handle } from './Data'
import { Snapshot, Hints, INIT, HANDLE, METHOD, UNMOUNT } from './Snapshot'
import { Transaction } from './Transaction'
import { MonitorImpl } from './MonitorImpl'
import { Hooks, OptionsImpl } from './Hooks'
import { Options, Kind, Reentrance, Trace } from '../Options'
import { Monitor, Worker } from '../Monitor'
import { Cache } from '../Cache'

const TOP_TIMESTAMP = Number.MAX_SAFE_INTEGER
type Call = { context: Snapshot, record: Record, result: Computation, reusable: boolean }

export class Method extends Cache<any> {
  private readonly handle: Handle
  private readonly name: FieldKey
  private readonly preset: Computation

  setup(options: Partial<Options>): Options { return this.reconfigure(options) }
  get options(): Options { return this.weak().result.options }
  get args(): ReadonlyArray<any> { return this.weak().result.args }
  get value(): any { return this.call(true, undefined).result.value }
  get error(): boolean { return this.weak().result.error }
  get stamp(): number { return this.weak().record.snapshot.timestamp }
  get invalid(): boolean { return !this.weak().reusable }
  invalidate(): void { Transaction.run(Dbg.isOn ? `invalidate(${Hints.handle(this.handle, this.name)})` : 'invalidate()', Method.invalidate, this) }
  pullValue(args?: any[]): any { return this.call(true, args).result.value }

  constructor(handle: Handle, name: FieldKey, options: OptionsImpl) {
    super()
    this.handle = handle
    this.name = name
    this.preset = new Computation(INIT, name, options)
    Computation.freeze(this.preset)
  }

  private initialize(): Computation {
    const hint: string = Dbg.isOn ? `${Hints.handle(this.handle)}.${this.name.toString()}/initialize` : /* istanbul ignore next */ 'Cache.init'
    const sidebyside = this.preset.options.reentrance === Reentrance.RunSideBySide
    const token = this.preset.options.kind === Kind.Cached ? this : undefined
    const result = Transaction.runEx<Computation>(hint, true, sidebyside, this.preset.options.trace, token, (): Computation => {
      const c = this.write().result
      c.ret = undefined
      c.value = undefined
      c.invalid.since = -1
      return c
    })
    this.preset.invalid.renewing = undefined
    return result
  }

  call(weak: boolean, args: any[] | undefined): Call {
    let call: Call = this.read(args)
    const ctx = call.context
    const c: Computation = call.result
    if (!call.reusable && (!weak || !c.invalid.renewing)) {
      const hint: string = Dbg.isOn ? `${Hints.handle(this.handle)}.${this.name.toString()}${args && args.length > 0 && (typeof args[0] === 'number' || typeof args[0] === 'string') ? `/${args[0]}` : ''}${c.invalid.hint ? `   <<   ${invalidationChain(c.invalid.hint, 0).join('   <<   ')}` : ''}` : /* istanbul ignore next */ 'Cache.run'
      const cfg = c.options
      const spawn = weak || cfg.kind === Kind.Trigger ||
        (cfg.kind === Kind.Cached && call.record.snapshot !== call.context)
      const sidebyside = cfg.reentrance === Reentrance.RunSideBySide
      const token = cfg.kind === Kind.Cached ? this : undefined
      const call2 = this.recompute(call, hint, spawn, sidebyside, cfg.trace, token, args)
      const ctx2 = call2.result.record.snapshot
      if (!weak || ctx === ctx2 || (ctx2.applied && ctx.timestamp >= ctx2.timestamp))
        call = call2
    }
    else if (Dbg.isOn && Dbg.trace.methods && (c.options.trace === undefined || c.options.trace.methods === undefined || c.options.trace.methods === true)) Dbg.log(Transaction.current.isFinished ? '' : '║', ' (=)', `${Hints.record(call.record)}.${this.name.toString()} result is reused from T${call.result.worker.id} ${call.result.worker.hint}`)
    Snapshot.markViewed(call.record, this.name, call.result, weak)
    return call
  }

  recompute(call: Call, hint: string, spawn: boolean, sidebyside: boolean, trace: Partial<Trace> | undefined, token: any, args: any[] | undefined): Call {
    // if (Dbg.isOn && Dbg.trace.invalidations) Dbg.log(spawn ? ' ' : '║', ' ■■■', `${Hints.record(call.record, call.cache.field)}${call.cache.invalid.hint ? `   <<   ${invalidationChain(call.cache.invalid.hint, 0).join('   <<   ')}` : ''}`)
    // TODO: Cleaner implementation is needed
    let call2 = call
    const ret = Transaction.runEx(hint, spawn, sidebyside, trace, token, (argsx: any[] | undefined): any => {
      if (call2.result.worker.isCanceled) {
        call2 = this.read(argsx) // re-read on retry
        if (!call2.reusable) {
          call2 = this.write()
          call2.result.compute(this.handle.proxy, argsx)
        }
      }
      else {
        call2 = this.write()
        call2.result.compute(this.handle.proxy, argsx)
      }
      return call2.result.ret
    }, args)
    call2.result.ret = ret
    return call2
  }

  private weak(): Call {
    const call = this.read(undefined)
    Snapshot.markViewed(call.record, this.name, call.result, true)
    return call
  }

  private read(args: any[] | undefined): Call {
    const ctx = Snapshot.readable()
    const r: Record = ctx.tryRead(this.handle)
    const c: Computation = r.data[this.name] || this.initialize()
    const reusable = c.options.kind !== Kind.Action &&
      (ctx === c.record.snapshot || ctx.timestamp < c.invalid.since) &&
      (!c.options.cachedArgs || args === undefined || c.args.length === args.length && c.args.every((t, i) => t === args[i])) ||
      r.data[UNMOUNT] !== undefined
    return { context: ctx, record: r, result: c, reusable }
  }

  private write(): Call {
    const ctx = Snapshot.writable()
    const f = this.name
    const r: Record = ctx.write(this.handle, f, HANDLE, this)
    let c: Computation = r.data[f] || this.preset
    if (c.record !== r) {
      const renewing = new Computation(r, f, c)
      r.data[f] = renewing
      renewing.error = Method.checkForReentrance(c)
      if (!renewing.error)
        c.invalid.renewing = renewing
      c = renewing
      ctx.bump(r.prev.record.snapshot.timestamp)
      Snapshot.markChanged(r, f, renewing, true)
    }
    return { context: ctx, record: r, result: c, reusable: true }
  }

  private static checkForReentrance(c: Computation): Error | undefined {
    let result: Error | undefined = undefined
    const prev = c.invalid.renewing
    const caller = Transaction.current
    if (prev && prev !== c && !prev.worker.isCanceled)
      switch (c.options.reentrance) {
        case Reentrance.PreventWithError:
          throw misuse(`${c.hint()} is not reentrant`)
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

  static invalidate(self: Method): void {
    const ctx = Snapshot.readable()
    const call = self.read(undefined)
    const c: Computation = call.result
    c.invalidateDueTo(c, {record: INIT, field: self.name, times: 0}, ctx.timestamp, ctx.triggers)
  }

  private reconfigure(options: Partial<Options>): Options {
    const call = this.read(undefined)
    const r: Record = call.record
    const hint: string = Dbg.isOn ? `setup(${Hints.handle(this.handle)}.${this.name.toString()})` : /* istanbul ignore next */ 'Cache.setup()'
    return Transaction.runEx(hint, false, false, undefined, undefined, (): Options => {
      const call2 = this.write()
      const c2: Computation = call2.result
      c2.options = new OptionsImpl(c2.options.body, c2.options, options, false)
      if (Dbg.isOn && Dbg.trace.writes) Dbg.log('║', '  w ', `${Hints.record(r)}.${this.name.toString()}.options = ...`)
      return c2.options
    })
  }

  static runAs<T>(c: Computation | undefined, func: F<T>, ...args: any[]): T {
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

  static createMethodTrap(h: Handle, field: FieldKey, options: OptionsImpl): F<any> {
    const method = new Method(h, field, options)
    const methodTrap: F<any> = (...args: any[]): any =>
      method.call(false, args).result.ret
    Utils.set(methodTrap, METHOD, method)
    return methodTrap
  }

  static of(method: F<any>): Cache<any> {
    const impl = Utils.get<Cache<any> | undefined>(method, METHOD)
    if (!impl)
      throw misuse('given method is not a reactronic cache')
    return impl
  }

  static unmount(...objects: any[]): Transaction {
    return Transaction.runEx('<unmount>', false, false,
      undefined, undefined, Method.doUnmount, ...objects)
  }

  private static doUnmount(...objects: any[]): Transaction {
    for (const x of objects) {
      if (Utils.get<Handle>(x, HANDLE))
        x[UNMOUNT] = UNMOUNT
    }
    return Transaction.current
  }
}

// Computation

class Computation extends Observable implements Observer {
  static current?: Computation = undefined
  static asyncTriggerBatch: Computation[] = []

  readonly worker: Worker
  readonly record: Record
  readonly field: FieldKey
  options: OptionsImpl
  args: any[]
  ret: any
  error: any
  started: number
  readonly invalid: { since: number, hint?: FieldHint, renewing?: Computation }
  readonly observables: Map<Observable, FieldHint>
  readonly margin: number

  constructor(record: Record, field: FieldKey, init: Computation | OptionsImpl) {
    super(undefined)
    this.worker = Transaction.current
    this.record = record
    this.field = field
    if (init instanceof Computation) {
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
    this.invalid = { since: 0, hint: undefined, renewing: undefined }
    this.observables = new Map<Observable, FieldHint>()
    this.margin = Computation.current ? Computation.current.margin + 1 : 1
  }

  hint(): string { return `${Hints.record(this.record, this.field)}` }

  get isComputation(): boolean { return true }

  bind<T>(func: F<T>): F<T> {
    const computationBound: F<T> = (...args: any[]): T => {
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, '║', '‾\\', `${Hints.record(this.record)}.${this.field.toString()} - step in  `, 0, '        │')
      const result = Method.runAs<T>(this, func, ...args)
      if (Dbg.isOn && Dbg.trace.steps && this.ret) Dbg.logAs({margin2: this.margin}, '║', '_/', `${Hints.record(this.record)}.${this.field.toString()} - step out `, 0, this.started > 0 ? '        │' : '')
      return result
    }
    return computationBound
  }

  compute(proxy: any, args: any[] | undefined): void {
    if (args)
      this.args = args
    this.invalid.since = TOP_TIMESTAMP
    if (!this.error)
      Method.runAs<void>(this, Computation.compute, proxy, this)
    else
      this.ret = Promise.reject(this.error)
  }

  static compute(proxy: any, c: Computation): void {
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
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log('║', '‾\\', `${Hints.record(this.record, this.field)} - enter`)
    this.started = Date.now()
  }

  leaveOrAsync(): void {
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
      if (Dbg.isOn && Dbg.trace.methods) Dbg.log('║', '_/', `${Hints.record(this.record, this.field)} - leave... `, 0, 'ASYNC ──┐')
    }
    else {
      this.value = this.ret
      this.leave('_/', '- leave')
    }
  }

  private leave(op: string, message: string, highlight: string | undefined = undefined): void {
    const ms: number = Date.now() - this.started
    this.started = 0
    if (Dbg.isOn && Dbg.trace.methods) Dbg.log('║', `${op}`, `${Hints.record(this.record, this.field)} ${message}`, ms, highlight)
    if (this.options.monitor)
      this.monitorLeave(this.options.monitor)
    // CacheResult.freeze(this)
  }

  private monitorEnter(mon: Monitor): void {
    Method.runAs<void>(undefined, Transaction.runEx, 'Monitor.enter',
      true, false, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
      MonitorImpl.enter, mon, this)
  }

  private monitorLeave(mon: Monitor): void {
    Transaction.outside<void>(() => {
      const leave = (): void => {
        Method.runAs<void>(undefined, Transaction.runEx, 'Monitor.leave',
          true, false, Dbg.isOn && Dbg.trace.monitors ? undefined : Dbg.global, undefined,
          MonitorImpl.leave, mon, this)
      }
      this.worker.whenFinished().then(leave, leave)
    })
  }

  finish(error?: any): void {
    const prev = this.record.prev.record.data[this.field]
    if (prev instanceof Computation && prev.invalid.renewing === this)
      prev.invalid.renewing = undefined
    if (Hooks.performanceWarningThreshold > 0) {
      this.observables.forEach((hint, value) => {
        if (hint.times > Hooks.performanceWarningThreshold) Dbg.log('', '[!]', `${this.hint()} uses ${Hints.record(hint.record, hint.field)} ${hint.times} times`, 0, ' *** WARNING ***')
      })
    }
  }

  trig(now: boolean, nothrow: boolean): void {
    const delay = this.options.delay
    if (now || delay === -1) {
      if (!this.error && (this.options.kind === Kind.Action || !this.invalid.renewing)) {
        try {
          const proxy: any = Utils.get<Handle>(this.record.data, HANDLE).proxy
          const trap: Function = Reflect.get(proxy, this.field, proxy)
          const method = Utils.get<Method>(trap, METHOD)
          const call: Call = method.call(false, undefined)
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
      setTimeout(() => this.trig(true, true), delay)
  }

  private addToAsyncTriggerBatch(): void {
    Computation.asyncTriggerBatch.push(this)
    if (Computation.asyncTriggerBatch.length === 1)
      setTimeout(Computation.processAsyncTriggerBatch, 0)
  }

  private static processAsyncTriggerBatch(): void {
    const triggers = Computation.asyncTriggerBatch
    Computation.asyncTriggerBatch = [] // reset
    for (const t of triggers)
      t.trig(true, true)
  }

  private static markViewed(record: Record, field: FieldKey, value: Observable, weak: boolean): void {
    const c: Computation | undefined = Computation.current // alias
    if (c && c.options.kind !== Kind.Action && field !== HANDLE) {
      const ctx = Snapshot.readable()
      ctx.bump(record.snapshot.timestamp)
      const t = weak ? -1 : ctx.timestamp
      if (!c.subscribeTo(record, field, value, t))
        c.invalidateDueTo(value, {record, field, times: 0}, ctx.timestamp, ctx.triggers)
    }
  }

  private static markChanged(r: Record, field: FieldKey, value: any, changed: boolean): void {
    changed ? r.changes.add(field) : r.changes.delete(field)
    if (Dbg.isOn && Dbg.trace.writes) changed ? Dbg.log('║', '  w ', `${Hints.record(r, field)} = ${valueHint(value)}`) : Dbg.log('║', '  w ', `${Hints.record(r, field)} = ${valueHint(value)}`, undefined, ' (same as previous)')
  }

  private static propagateChanges(snapshot: Snapshot): void {
    const timestamp = snapshot.timestamp
    const triggers = snapshot.triggers
    // Mark previous values as replaced and invalidate existing observers
    snapshot.changeset.forEach((r: Record, h: Handle) => {
      if (!r.changes.has(UNMOUNT))
        r.changes.forEach(field =>
          Computation.markPrevValueAsReplaced(timestamp, r, field, triggers))
      else
        for (const field in r.prev.record.data)
          Computation.markPrevValueAsReplaced(timestamp, r, field, triggers)
    })
    // Subscribe to new observers and finish cache computations
    snapshot.changeset.forEach((r: Record, h: Handle) => {
      if (!r.changes.has(UNMOUNT))
        r.changes.forEach(field => Computation.finish(r, field, false))
      else
        for (const field in r.prev.record.data)
          Computation.finish(r, field, true)
    })
  }

  private static discardChanges(snapshot: Snapshot): void {
    snapshot.changeset.forEach((r: Record, h: Handle) =>
      r.changes.forEach(field => Computation.finish(r, field, true)))
  }

  private static markPrevValueAsReplaced(timestamp: number, record: Record, field: FieldKey, triggers: Observer[]): void {
    const prev = record.prev.record
    const value = prev.data[field] as Observable
    if (value !== undefined && value.replacement === undefined) {
      value.replacement = record
      const hint: FieldHint = { record, field, times: 0 }
      if (value instanceof Computation && (value.invalid.since === TOP_TIMESTAMP || value.invalid.since <= 0)) {
        value.invalid.hint = hint
        value.invalid.since = timestamp
        value.unsubscribeFromAll()
      }
      if (value.observers)
        value.observers.forEach(c => c.invalidateDueTo(value, hint, timestamp, triggers))
    }
  }

  private static finish(record: Record, field: FieldKey, cancel: boolean): void {
    const cache = record.data[field]
    if (cache instanceof Computation && cache.record === record) {
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
      if ((Dbg.isOn && Dbg.trace.subscriptions || (this.options.trace && this.options.trace.subscriptions))) Dbg.logAs(this.options.trace, Snapshot.readable().applied ? ' ' : '║', '  - ', `${Hints.record(this.record, this.field)} is unsubscribed from ${Hints.record(hint.record, hint.field, true)}`)
    })
    this.observables.clear() // now fully unlinked
  }

  private subscribeTo(record: Record, field: FieldKey, value: Observable, timestamp: number): boolean {
    let result = value.replacement === undefined
    if (result && timestamp !== -1)
      result = !(value instanceof Computation && timestamp >= value.invalid.since)
    if (result) {
      // Performance tracking
      let times: number = 0
      if (Hooks.performanceWarningThreshold > 0) {
        const existing = this.observables.get(value)
        times = existing ? existing.times + 1 : 1
      }
      // Acquire observers
      if (!value.observers)
        value.observers = new Set<Computation>()
      // Two-way linking
      const hint: FieldHint = {record, field, times}
      value.observers.add(this)
      this.observables.set(value, hint)
      if ((Dbg.isOn && Dbg.trace.subscriptions || (this.options.trace && this.options.trace.subscriptions))) Dbg.logAs(this.options.trace, '║', '  ∞ ', `${Hints.record(this.record, this.field)} is subscribed to ${Hints.record(hint.record, hint.field, true)}${hint.times > 1 ? ` (${hint.times} times)` : ''}`)
    }
    return result || value.replacement === record
  }

  invalidateDueTo(value: Observable, hint: FieldHint, since: number, triggers: Observer[]): void {
    if (this.invalid.since === TOP_TIMESTAMP || this.invalid.since <= 0) {
      const notSelfInvalidation = value.isComputation ||
        hint.record.snapshot !== this.record.snapshot ||
        !hint.record.changes.has(hint.field)
      if (notSelfInvalidation) {
        this.invalid.hint = hint
        this.invalid.since = since
        this.unsubscribeFromAll()
        const isTrigger = this.options.kind === Kind.Trigger && this.record.data[UNMOUNT] === undefined
        if (Dbg.isOn && Dbg.trace.invalidations || (this.options.trace && this.options.trace.invalidations)) Dbg.logAs(this.options.trace, Snapshot.readable().applied ? ' ' : '║', isTrigger ? '█' : '▒', isTrigger && hint.record === this.record && hint.field === this.field ? `${this.hint()} is a trigger and will run automatically` : `${this.hint()} is invalidated by ${Hints.record(hint.record, hint.field)} since v${since}${isTrigger ? ' and will run automatically' : ''}`)
        if (isTrigger) // stop cascade invalidation on trigger
          triggers.push(this)
        else if (this.observers) // cascade invalidation
          this.observers.forEach(c => c.invalidateDueTo(this, {record: this.record, field: this.field, times: 0}, since, triggers))
        if (!this.worker.isFinished)
          this.worker.cancel(new Error(`T${this.worker.id} (${this.worker.hint}) is canceled due to invalidation by ${Hints.record(hint.record, hint.field)}`), null)
      }
      else if (Dbg.isOn && Dbg.trace.invalidations || (this.options.trace && this.options.trace.invalidations)) Dbg.logAs(this.options.trace, Snapshot.readable().applied ? ' ' : '║', 'x', `${this.hint()} invalidation is skipped`)
    }
  }

  static isConflicting(oldValue: any, newValue: any): boolean {
    let result = oldValue !== newValue
    if (result)
      result = oldValue instanceof Computation && oldValue.invalid.since !== -1
    return result
  }

  static freeze(c: Computation): void {
    Utils.freezeMap(c.observables)
    Object.freeze(c)
  }

  static init(): void {
    Dbg.getCurrentTrace = getCurrentTrace
    Snapshot.markViewed = Computation.markViewed // override
    Snapshot.markChanged = Computation.markChanged // override
    Snapshot.isConflicting = Computation.isConflicting // override
    Snapshot.propagateChanges = Computation.propagateChanges // override
    Snapshot.discardChanges = Computation.discardChanges // override
    Hooks.createCacheTrap = Method.createMethodTrap // override
    Promise.prototype.then = fReactronicThen // override
  }
}

function invalidationChain(hint: FieldHint, since: number): string[] {
  const result: string[] = []
  let value: Observable = hint.record.data[hint.field]
  while (value instanceof Computation && value.invalid.hint) {
    result.push(Hints.record(hint.record, hint.field))
    hint = value.invalid.hint
    value = hint.record.data[hint.field]
  }
  result.push(Hints.record(hint.record, hint.field))
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
    result = `<recompute:${Hints.record(value.record.prev.record, undefined, true)}>`
  else if (value === UNMOUNT)
    result = '<unmount>'
  else if (value !== undefined && value !== null)
    result = value.toString().slice(0, 20)
  else
    result = '◌'
  return result
}

function getCurrentTrace(local: Partial<Trace> | undefined): Trace {
  const t = Transaction.current
  let res = Dbg.merge(t.trace, t.id > 1 ? 31 + t.id % 6 : 37, t.id > 1 ? `T${t.id}` : '', Dbg.global)
  res = Dbg.merge({margin1: t.margin}, undefined, undefined, res)
  if (Computation.current)
    res = Dbg.merge({margin2: Computation.current.margin}, undefined, undefined, res)
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
    const computation = Computation.current
    if (computation) {
      resolve = computation.bind(resolve)
      reject = computation.bind(reject)
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

Computation.init()
