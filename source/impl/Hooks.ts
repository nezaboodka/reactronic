// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { UNDEF, F } from '../util/Utils'
import { Log, misuse } from '../util/Dbg'
import { MemberOptions, Kind, Reentrance } from '../Options'
import { LoggingOptions, ProfilingOptions } from '../Logging'
import { Controller } from '../Controller'
import { ObjectSnapshot, MemberName, ObjectHandle, Subscription, Meta, StandaloneMode } from './Data'
import { Changeset, Dump, EMPTY_SNAPSHOT } from './Snapshot'
import { Journal } from './Journal'
import { Monitor } from './Monitor'

// ReactiveObject

export abstract class ReactiveObject {
  constructor() {
    const proto = new.target.prototype
    const initial = Meta.getFrom(proto, Meta.Initial)
    const h = Hooks.createDataHandleForReactiveObject(proto, this, initial, new.target.name)
    return h.proxy
  }

  /* istanbul ignore next */
  [Symbol.toStringTag](): string {
    const h = Meta.get<ObjectHandle>(this, Meta.Handle)
    return Dump.obj(h)
  }
}

// ReactiveArray

export class ReactiveArray extends ReactiveObject {
  // WIP
}

// Options

const DEFAULT_OPTIONS: MemberOptions = Object.freeze({
  kind: Kind.Plain,
  standalone: false,
  order: 0,
  noSideEffects: false,
  triggeringArgs: false,
  throttling: Number.MAX_SAFE_INTEGER, // disabled reaction, @reaction sets it to -1 to enable
  reentrance: Reentrance.PreventWithError,
  journal: undefined,
  monitor: null,
  logging: undefined,
})

export class OptionsImpl implements MemberOptions {
  readonly getter: Function
  readonly setter: Function
  readonly kind: Kind
  readonly standalone: StandaloneMode
  readonly order: number
  readonly noSideEffects: boolean
  readonly triggeringArgs: boolean
  readonly throttling: number
  readonly reentrance: Reentrance
  readonly journal: Journal | undefined
  readonly monitor: Monitor | null
  readonly logging?: Partial<LoggingOptions>
  static readonly INITIAL = Object.freeze(new OptionsImpl(UNDEF, UNDEF, { getter: UNDEF, setter: UNDEF, ...DEFAULT_OPTIONS }, {}, false))

  constructor(getter: Function | undefined, setter: Function | undefined, existing: OptionsImpl, patch: Partial<OptionsImpl>, implicit: boolean) {
    this.getter = getter !== undefined ? getter : existing.getter
    this.setter = setter !== undefined ? setter : existing.setter
    this.kind = merge(DEFAULT_OPTIONS.kind, existing.kind, patch.kind, implicit)
    this.standalone = merge(DEFAULT_OPTIONS.standalone, existing.standalone, patch.standalone, implicit)
    this.order = merge(DEFAULT_OPTIONS.order, existing.order, patch.order, implicit)
    this.noSideEffects = merge(DEFAULT_OPTIONS.noSideEffects, existing.noSideEffects, patch.noSideEffects, implicit)
    this.triggeringArgs = merge(DEFAULT_OPTIONS.triggeringArgs, existing.triggeringArgs, patch.triggeringArgs, implicit)
    this.throttling = merge(DEFAULT_OPTIONS.throttling, existing.throttling, patch.throttling, implicit)
    this.reentrance = merge(DEFAULT_OPTIONS.reentrance, existing.reentrance, patch.reentrance, implicit)
    this.journal = merge(DEFAULT_OPTIONS.journal, existing.journal, patch.journal, implicit)
    this.monitor = merge(DEFAULT_OPTIONS.monitor, existing.monitor, patch.monitor, implicit)
    this.logging = merge(DEFAULT_OPTIONS.logging, existing.logging, patch.logging, implicit)
    if (Log.isOn)
      Object.freeze(this)
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing
}

// Hooks

export class Hooks implements ProxyHandler<ObjectHandle> {
  static reactionsAutoStartDisabled: boolean = false
  static repetitiveUsageWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static mainThreadBlockingWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static asyncActionDurationWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static sensitivity: boolean = false
  static readonly handler: Hooks = new Hooks()

  getPrototypeOf(h: ObjectHandle): object | null {
    return Reflect.getPrototypeOf(h.data)
  }

  get(h: ObjectHandle, m: MemberName, receiver: any): any {
    let result: any
    const os: ObjectSnapshot = Changeset.current().getRelevantSnapshot(h, m)
    result = os.data[m]
    if (result instanceof Subscription && !result.isOperation) {
      Changeset.markUsed(result, os, m, h, Kind.Plain, false)
      result = result.content
    }
    else if (m === Meta.Handle) {
      // do nothing, just return instance
    }
    else // result === NONREACTIVE
      result = Reflect.get(h.data, m, receiver)
    return result
  }

  set(h: ObjectHandle, m: MemberName, value: any, receiver: any): boolean {
    const os: ObjectSnapshot = Changeset.edit().getEditableSnapshot(h, m, value)
    if (os !== EMPTY_SNAPSHOT) {
      let curr = os.data[m] as Subscription
      if (curr !== undefined || (os.former.snapshot.changeset === EMPTY_SNAPSHOT.changeset && (m in h.data) === false)) {
        if (curr === undefined || curr.content !== value || Hooks.sensitivity) {
          const existing = curr?.content
          if (os.former.snapshot.data[m] === curr) {
            curr = os.data[m] = new Subscription(value)
            Changeset.markEdited(existing, value, true, os, m, h)
          }
          else {
            curr.content = value
            Changeset.markEdited(existing, value, true, os, m, h)
          }
        }
      }
      else
        Reflect.set(h.data, m, value, receiver)
    }
    else
      h.data[m] = value
    return true
  }

  has(h: ObjectHandle, m: MemberName): boolean {
    const os: ObjectSnapshot = Changeset.current().getRelevantSnapshot(h, m)
    return m in os.data || m in h.data
  }

  getOwnPropertyDescriptor(h: ObjectHandle, m: MemberName): PropertyDescriptor | undefined {
    const os: ObjectSnapshot = Changeset.current().getRelevantSnapshot(h, m)
    const pd = Reflect.getOwnPropertyDescriptor(os.data, m)
    if (pd)
      pd.configurable = pd.writable = true
    return pd
  }

  ownKeys(h: ObjectHandle): Array<string | symbol> {
    // TODO: Better implementation to avoid filtering
    const os: ObjectSnapshot = Changeset.current().getRelevantSnapshot(h, Meta.Handle)
    const result = []
    for (const m of Object.getOwnPropertyNames(os.data)) {
      const value = os.data[m]
      if (!(value instanceof Subscription) || !value.isOperation)
        result.push(m)
    }
    return result
  }

  static decorateData(reactive: boolean, proto: any, m: MemberName): any {
    if (reactive) {
      const get = function(this: any): any {
        const h = Hooks.acquireDataHandle(this)
        return Hooks.handler.get(h, m, this)
      }
      const set = function(this: any, value: any): boolean {
        const h = Hooks.acquireDataHandle(this)
        return Hooks.handler.set(h, m, value, this)
      }
      const enumerable = true
      const configurable = false
      return Object.defineProperty(proto, m, { get, set, enumerable, configurable })
    }
    else
      Meta.acquire(proto, Meta.Initial)[m] = Meta.Nonreactive
  }

  static decorateOperation(implicit: boolean, decorator: Function,
    options: Partial<MemberOptions>, proto: any, member: MemberName,
    pd: PropertyDescriptor | undefined): any {
    if (pd === undefined || pd === proto) // pd !== proto only for the first decorator in a chain
      pd = EMPTY_PROP_DESCRIPTOR
    const enumerable: boolean = pd.enumerable ?? true
    const configurable: boolean = pd.configurable ?? true
    const opts = Hooks.rememberOperationOptions(proto, member,
      pd.value ?? pd.get, pd.value ?? pd.set, true, configurable, options, implicit)
    if (opts.getter === opts.setter) { // regular method
      const bootstrap = function(this: any): any {
        const h = Hooks.acquireDataHandle(this)
        const operation = Hooks.createOperation(h, member, opts)
        Object.defineProperty(h.data, member, { value: operation, enumerable, configurable })
        return operation
      }
      return Object.defineProperty(proto, member, { get: bootstrap, enumerable, configurable: true })
    }
    else if (opts.setter === UNDEF) { // property with getter only
      const bootstrap = function(this: any): any {
        const h = Hooks.acquireDataHandle(this)
        const operation = Hooks.createOperation(h, member, opts)
        Object.defineProperty(h.data, member, { get: operation, enumerable, configurable })
        return operation.call(this)
      }
      return Object.defineProperty(proto, member, { get: bootstrap, enumerable, configurable: true })
    }
    else // property having setter
      throw misuse(`${proto.constructor.name}.${member.toString()} has setter and cannot be decorated with @${decorator.name}`)
  }

  static decorateOperationParametrized(decorator: Function, options: Partial<MemberOptions>): F<any> {
    return function(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
      return Hooks.decorateOperation(false, decorator, options, proto, prop, pd) /* istanbul ignore next */
    }
  }

  static acquireDataHandle(obj: any): ObjectHandle {
    let h = obj[Meta.Handle]
    if (!h) {
      if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
        throw misuse('only objects can be reactive')
      const initial = Meta.getFrom(Object.getPrototypeOf(obj), Meta.Initial)
      const os = new ObjectSnapshot(EMPTY_SNAPSHOT.changeset, EMPTY_SNAPSHOT, {...initial})
      Meta.set(os.data, Meta.Handle, h)
      h = new ObjectHandle(obj, obj, Hooks.handler, os, obj.constructor.name)
      Meta.set(obj, Meta.Handle, h)
    }
    return h
  }

  static createDataHandleForReactiveObject(proto: any, data: any, blank: any, hint: string): ObjectHandle {
    const ctx = Changeset.edit()
    const h = new ObjectHandle(data, undefined, Hooks.handler, EMPTY_SNAPSHOT, hint)
    ctx.getEditableSnapshot(h, Meta.Handle, blank)
    if (!Hooks.reactionsAutoStartDisabled)
      for (const m in Meta.getFrom(proto, Meta.Reactions))
        (h.proxy[m][Meta.Controller] as Controller<any>).markObsolete()
    return h
  }

  static setProfilingMode(isOn: boolean, options?: Partial<ProfilingOptions>): void {
    if (isOn) {
      Hooks.repetitiveUsageWarningThreshold = options && options.repetitiveUsageWarningThreshold !== undefined ? options.repetitiveUsageWarningThreshold : 10
      Hooks.mainThreadBlockingWarningThreshold = options && options.mainThreadBlockingWarningThreshold !== undefined ? options.mainThreadBlockingWarningThreshold : 14
      Hooks.asyncActionDurationWarningThreshold = options && options.asyncActionDurationWarningThreshold !== undefined ? options.asyncActionDurationWarningThreshold : 300
      Changeset.garbageCollectionSummaryInterval = options && options.garbageCollectionSummaryInterval !== undefined ? options.garbageCollectionSummaryInterval : 100
    }
    else {
      Hooks.repetitiveUsageWarningThreshold = Number.MAX_SAFE_INTEGER
      Hooks.mainThreadBlockingWarningThreshold = Number.MAX_SAFE_INTEGER
      Hooks.asyncActionDurationWarningThreshold = Number.MAX_SAFE_INTEGER
      Changeset.garbageCollectionSummaryInterval = Number.MAX_SAFE_INTEGER
    }
  }

  static sensitive<T>(sensitivity: boolean, func: F<T>, ...args: any[]): T {
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
      const h = Hooks.acquireDataHandle(obj)
      h.hint = hint
    }
    return obj
  }

  /* istanbul ignore next */
  static createOperation = function(h: ObjectHandle, m: MemberName, options: OptionsImpl): F<any> {
    throw misuse('createOperation should never be called')
  }

  /* istanbul ignore next */
  static rememberOperationOptions = function(proto: any, m: MemberName, getter: Function | undefined, setter: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<MemberOptions>, implicit: boolean): OptionsImpl {
    throw misuse('rememberOperationOptions should never be called')
  }
}

const EMPTY_PROP_DESCRIPTOR: PropertyDescriptor = {
  configurable: true,
  enumerable: true,
  value: undefined,
}
