// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { UNDEF, F } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { MemberOptions, Kind, Reentrance, Sensitivity } from '../Options'
import { TraceOptions, ProfilingOptions } from '../Trace'
import { Controller } from '../Controller'
import { ObjectRevision, MemberName, ObjectHolder, Observable, Meta } from './Data'
import { Snapshot, Hints, NIL_REV } from './Snapshot'
import { TransactionJournal } from './TransactionJournal'
import { Monitor } from './Monitor'

// ObservableObject

export abstract class ObservableObject {
  constructor() {
    const proto = new.target.prototype
    const initial = Meta.getFrom(proto, Meta.Initial)
    const h = Hooks.createObjectHolder(this, initial, new.target.name)
    if (!Hooks.reactionsAutoStartDisabled) {
      const reactions = Meta.getFrom(proto, Meta.Reactions)
      for (const member in reactions)
        (h.proxy[member][Meta.Controller] as Controller<any>).markObsolete()
    }
    return h.proxy
  }

  /* istanbul ignore next */
  [Symbol.toStringTag](): string {
    const h = Meta.get<ObjectHolder>(this, Meta.Holder)
    return Hints.obj(h)
  }
}

// Options

const DEFAULT_OPTIONS: MemberOptions = Object.freeze({
  kind: Kind.Data,
  priority: 0,
  noSideEffects: false,
  sensitiveArgs: false,
  throttling: Number.MAX_SAFE_INTEGER, // disabled reaction
  reentrance: Reentrance.PreventWithError,
  journal: undefined,
  monitor: null,
  trace: undefined,
})

export class OptionsImpl implements MemberOptions {
  readonly body: Function
  readonly kind: Kind
  readonly priority: number
  readonly noSideEffects: boolean
  readonly sensitiveArgs: boolean
  readonly throttling: number
  readonly reentrance: Reentrance
  readonly journal: TransactionJournal | undefined
  readonly monitor: Monitor | null
  readonly trace?: Partial<TraceOptions>
  static readonly INITIAL = Object.freeze(new OptionsImpl(UNDEF, { body: UNDEF, ...DEFAULT_OPTIONS }, {}, false))

  constructor(body: Function | undefined, existing: OptionsImpl, patch: Partial<OptionsImpl>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body
    this.kind = merge(DEFAULT_OPTIONS.kind, existing.kind, patch.kind, implicit)
    this.priority = merge(DEFAULT_OPTIONS.priority, existing.priority, patch.priority, implicit)
    this.noSideEffects = merge(DEFAULT_OPTIONS.noSideEffects, existing.noSideEffects, patch.noSideEffects, implicit)
    this.sensitiveArgs = merge(DEFAULT_OPTIONS.sensitiveArgs, existing.sensitiveArgs, patch.sensitiveArgs, implicit)
    this.throttling = merge(DEFAULT_OPTIONS.throttling, existing.throttling, patch.throttling, implicit)
    this.reentrance = merge(DEFAULT_OPTIONS.reentrance, existing.reentrance, patch.reentrance, implicit)
    this.journal = merge(DEFAULT_OPTIONS.journal, existing.journal, patch.journal, implicit)
    this.monitor = merge(DEFAULT_OPTIONS.monitor, existing.monitor, patch.monitor, implicit)
    this.trace = merge(DEFAULT_OPTIONS.trace, existing.trace, patch.trace, implicit)
    if (Dbg.isOn)
      Object.freeze(this)
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing
}

// Hooks

export class Hooks implements ProxyHandler<ObjectHolder> {
  static reactionsAutoStartDisabled: boolean = false
  static repetitiveReadWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static mainThreadBlockingWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static asyncActionDurationWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static sensitivity: Sensitivity = Sensitivity.ReactOnFinalDifferenceOnly
  static readonly proxy: Hooks = new Hooks()

  getPrototypeOf(h: ObjectHolder): object | null {
    return Reflect.getPrototypeOf(h.plain)
  }

  get(h: ObjectHolder, m: MemberName, receiver: any): any {
    let result: any
    const r: ObjectRevision = Snapshot.current().getCurrentRevision(h, m)
    result = r.data[m]
    if (result instanceof Observable && !result.isOperation) {
      Snapshot.markUsed(result, r, m, h, Kind.Data, false)
      result = result.value
    }
    else if (m === Meta.Holder) {
      // do nothing, just return instance
    }
    else // result === PLAIN
      result = Reflect.get(h.plain, m, receiver)
    return result
  }

  set(h: ObjectHolder, m: MemberName, value: any, receiver: any): boolean {
    const r: ObjectRevision = Snapshot.edit().getEditableRevision(h, m, value)
    if (r !== NIL_REV) {
      const curr = r.data[m] as Observable
      if (curr !== undefined || (
        r.prev.revision.snapshot === NIL_REV.snapshot && m in h.plain === false)) {
        const prev = r.prev.revision.data[m] as Observable
        let edited = prev === undefined || prev.value !== value ||
          Hooks.sensitivity === Sensitivity.ReactEvenOnSameValueAssignment
        if (edited) {
          if (prev === curr)
            r.data[m] = new Observable(value)
          else
            curr.value = value
        }
        else if (prev !== curr) { // if there was an assignment before
          if (Hooks.sensitivity === Sensitivity.ReactOnFinalDifferenceOnly)
            r.data[m] = prev // restore previous value
          else
            edited = true // Sensitivity.ReactOnFinalAndIntermediateDifference
        }
        Snapshot.markEdited(value, edited, r, m, h)
      }
      else
        Reflect.set(h.plain, m, value, receiver)
    }
    else
      h.plain[m] = value
    return true
  }

  has(h: ObjectHolder, m: MemberName): boolean {
    const r: ObjectRevision = Snapshot.current().getCurrentRevision(h, m)
    return m in r.data || m in h.plain
  }

  getOwnPropertyDescriptor(h: ObjectHolder, m: MemberName): PropertyDescriptor | undefined {
    const r: ObjectRevision = Snapshot.current().getCurrentRevision(h, m)
    const pd = Reflect.getOwnPropertyDescriptor(r.data, m)
    if (pd)
      pd.configurable = pd.writable = true
    return pd
  }

  ownKeys(h: ObjectHolder): Array<string | symbol> {
    // TODO: Better implementation to avoid filtering
    const r: ObjectRevision = Snapshot.current().getCurrentRevision(h, Meta.Holder)
    const result = []
    for (const m of Object.getOwnPropertyNames(r.data)) {
      const value = r.data[m]
      if (!(value instanceof Observable) || !value.isOperation)
        result.push(m)
    }
    return result
  }

  static decorateData(observable: boolean, proto: any, m: MemberName): any {
    if (observable) {
      const get = function(this: any): any {
        const h = Hooks.acquireObjectHolder(this)
        return Hooks.proxy.get(h, m, this)
      }
      const set = function(this: any, value: any): boolean {
        const h = Hooks.acquireObjectHolder(this)
        return Hooks.proxy.set(h, m, value, this)
      }
      const enumerable = true
      const configurable = false
      return Object.defineProperty(proto, m, { get, set, enumerable, configurable })
    }
    else
      Meta.acquire(proto, Meta.Initial)[m] = Meta.Plain
  }

  static decorateOperation(implicit: boolean, decorator: Function,
    options: Partial<MemberOptions>, proto: any, member: MemberName,
    pd: PropertyDescriptor): any {
    if (!pd || pd === proto) // pd === proto for all decorators except the first one
      pd = EMPTY_PROP_DESCRIPTOR
    const enumerable: boolean = pd.enumerable ?? true
    const configurable: boolean = pd.configurable ?? true
    const opts = Hooks.applyOperationOptions(proto, member, pd.value, true, configurable, options, implicit)
    if (opts.body !== UNDEF) { // regular method
      const bootstrap = function(this: any): any {
        const h = Hooks.acquireObjectHolder(this)
        const hook = Hooks.createOperationHook(h, member, opts)
        Object.defineProperty(h.plain, member, { value: hook, enumerable, configurable })
        return hook
      }
      return Object.defineProperty(proto, member, { get: bootstrap, enumerable, configurable: true })
    }
    else { // property with getter/setter
      misuse(`@${decorator.name} ${proto.constructor.name}.${member.toString()} is ignored, because not supported yet`, '')
      return Object.defineProperty(proto, member, pd)
    }
  }

  static decorateOperationParametrized(decorator: Function, options: Partial<MemberOptions>): F<any> {
    return function(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
      return Hooks.decorateOperation(false, decorator, options, proto, prop, pd) /* istanbul ignore next */
    }
  }

  static acquireObjectHolder(obj: any): ObjectHolder {
    let h = obj[Meta.Holder]
    if (!h) {
      if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
        throw misuse('only objects can be reactive')
      const initial = Meta.getFrom(Object.getPrototypeOf(obj), Meta.Initial)
      const rev = new ObjectRevision(NIL_REV.snapshot, NIL_REV, {...initial})
      Meta.set(rev.data, Meta.Holder, h)
      if (Dbg.isOn)
        Snapshot.freezeObjectRevision(rev)
      h = new ObjectHolder(obj, obj, Hooks.proxy, rev, obj.constructor.name)
      Meta.set(obj, Meta.Holder, h)
    }
    return h
  }

  static createObjectHolder(plain: any, blank: any, hint: string): ObjectHolder {
    const ctx = Snapshot.edit()
    const h = new ObjectHolder(plain, undefined, Hooks.proxy, NIL_REV, hint)
    ctx.getEditableRevision(h, Meta.Holder, blank)
    return h
  }

  static setProfilingMode(enabled: boolean, options?: Partial<ProfilingOptions>): void {
    if (enabled) {
      Hooks.repetitiveReadWarningThreshold = options && options.repetitiveReadWarningThreshold !== undefined ? options.repetitiveReadWarningThreshold : 10
      Hooks.mainThreadBlockingWarningThreshold = options && options.mainThreadBlockingWarningThreshold !== undefined ? options.mainThreadBlockingWarningThreshold : 16.6
      Hooks.asyncActionDurationWarningThreshold = options && options.asyncActionDurationWarningThreshold !== undefined ? options.asyncActionDurationWarningThreshold : 150
      Snapshot.garbageCollectionSummaryInterval = options && options.garbageCollectionSummaryInterval !== undefined ? options.garbageCollectionSummaryInterval : 100
    }
    else {
      Hooks.repetitiveReadWarningThreshold = Number.MAX_SAFE_INTEGER
      Hooks.mainThreadBlockingWarningThreshold = Number.MAX_SAFE_INTEGER
      Hooks.asyncActionDurationWarningThreshold = Number.MAX_SAFE_INTEGER
      Snapshot.garbageCollectionSummaryInterval = Number.MAX_SAFE_INTEGER
    }
  }

  static sensitive<T>(sensitivity: Sensitivity, func: F<T>, ...args: any[]): T {
    const restore = Hooks.sensitivity
    Hooks.sensitivity = sensitivity
    try {
      return func(...args)
    }
    finally {
      Hooks.sensitivity = restore
    }
  }

  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const h = Hooks.acquireObjectHolder(obj)
      h.hint = hint
    }
    return obj
  }

  /* istanbul ignore next */
  static createOperationHook = function(h: ObjectHolder, m: MemberName, options: OptionsImpl): F<any> {
    throw misuse('createOperationHook should never be called')
  }

  /* istanbul ignore next */
  static applyOperationOptions = function(proto: any, m: MemberName, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<MemberOptions>, implicit: boolean): OptionsImpl {
    throw misuse('applyOperationOptions should never be called')
  }
}

const EMPTY_PROP_DESCRIPTOR: PropertyDescriptor = {
  configurable: true,
  enumerable: true,
  value: undefined,
}
