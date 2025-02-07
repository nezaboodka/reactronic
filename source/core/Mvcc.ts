// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { UNDEF, F } from "../util/Utils.js"
import { Log, misuse } from "../util/Dbg.js"
import { Operation, MemberOptions, Kind, Reentrance, Isolation } from "../Options.js"
import { LoggingOptions, ProfilingOptions } from "../Logging.js"
import { ObjectVersion, FieldKey, ObjectHandle, FieldVersion, Meta } from "./Data.js"
import { Changeset, Dump, EMPTY_OBJECT_VERSION } from "./Changeset.js"
import { Journal } from "./Journal.js"
import { Indicator } from "./Indicator.js"

// MvccObject, TransactionalObject, ObservableObject

export abstract class MvccObject {
  protected constructor(observable: boolean) {
    const proto = new.target.prototype
    const initial = Meta.getFrom(proto, Meta.Initial)
    const h = Mvcc.createHandleForMvccObject(
      proto, this, initial, new.target.name, observable)
    return h.proxy
  }

  /* istanbul ignore next */
  [Symbol.toStringTag](): string {
    const h = Meta.get<ObjectHandle>(this, Meta.Handle)
    return Dump.obj(h)
  }
}

export abstract class TransactionalObject extends MvccObject {
  constructor() {
    super(false)
  }
}

export abstract class ObservableObject extends MvccObject {
  constructor() {
    super(true)
  }
}

// Options

const DEFAULT_OPTIONS: MemberOptions = Object.freeze({
  kind: Kind.plain,
  isolation: Isolation.joinToCurrentTransaction,
  order: 0,
  noSideEffects: false,
  triggeringArgs: false,
  throttling: Number.MAX_SAFE_INTEGER, // disabled, @reactive sets it to -1 to enable
  reentrance: Reentrance.preventWithError,
  allowObsoleteToFinish: false,
  journal: undefined,
  indicator: null,
  logging: undefined,
})

export class OptionsImpl implements MemberOptions {
  readonly getter: Function
  readonly setter: Function
  readonly kind: Kind
  readonly isolation: Isolation
  readonly order: number
  readonly noSideEffects: boolean
  readonly triggeringArgs: boolean
  readonly throttling: number
  readonly reentrance: Reentrance
  readonly allowObsoleteToFinish: boolean
  readonly journal: Journal | undefined
  readonly indicator: Indicator | null
  readonly logging?: Partial<LoggingOptions>
  static readonly INITIAL = Object.freeze(new OptionsImpl(UNDEF, UNDEF, { getter: UNDEF, setter: UNDEF, ...DEFAULT_OPTIONS }, {}, false))

  constructor(getter: Function | undefined, setter: Function | undefined, existing: OptionsImpl, patch: Partial<OptionsImpl>, implicit: boolean) {
    this.getter = getter !== undefined ? getter : existing.getter
    this.setter = setter !== undefined ? setter : existing.setter
    this.kind = merge(DEFAULT_OPTIONS.kind, existing.kind, patch.kind, implicit)
    this.isolation = merge(DEFAULT_OPTIONS.isolation, existing.isolation, patch.isolation, implicit)
    this.order = merge(DEFAULT_OPTIONS.order, existing.order, patch.order, implicit)
    this.noSideEffects = merge(DEFAULT_OPTIONS.noSideEffects, existing.noSideEffects, patch.noSideEffects, implicit)
    this.triggeringArgs = merge(DEFAULT_OPTIONS.triggeringArgs, existing.triggeringArgs, patch.triggeringArgs, implicit)
    this.throttling = merge(DEFAULT_OPTIONS.throttling, existing.throttling, patch.throttling, implicit)
    this.reentrance = merge(DEFAULT_OPTIONS.reentrance, existing.reentrance, patch.reentrance, implicit)
    this.allowObsoleteToFinish = merge(DEFAULT_OPTIONS.allowObsoleteToFinish, existing.allowObsoleteToFinish, patch.allowObsoleteToFinish, implicit)
    this.journal = merge(DEFAULT_OPTIONS.journal, existing.journal, patch.journal, implicit)
    this.indicator = merge(DEFAULT_OPTIONS.indicator, existing.indicator, patch.indicator, implicit)
    this.logging = merge(DEFAULT_OPTIONS.logging, existing.logging, patch.logging, implicit)
    if (Log.isOn)
      Object.freeze(this)
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing
}

// Mvcc

export class Mvcc implements ProxyHandler<ObjectHandle> {
  static reactivityAutoStartDisabled: boolean = false
  static repetitiveUsageWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static mainThreadBlockingWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static asyncActionDurationWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static sensitivity: boolean = false
  static readonly transactional: Mvcc = new Mvcc(false)
  static readonly observable: Mvcc = new Mvcc(true)

  readonly isObservable: boolean

  constructor(isObservable: boolean) {
    this.isObservable = isObservable
  }

  getPrototypeOf(h: ObjectHandle): object | null {
    return Reflect.getPrototypeOf(h.data)
  }

  get(h: ObjectHandle, fk: FieldKey, receiver: any): any {
    let result: any
    if (fk !== Meta.Handle) {
      const cs = Changeset.current()
      const ov: ObjectVersion = cs.getObjectVersion(h, fk)
      result = ov.data[fk]
      if (result instanceof FieldVersion && !result.isLaunch) {
        if (this.isObservable)
          Changeset.markUsed(result, ov, fk, h, Kind.plain, false)
        result = result.content
      }
      else // result === RAW
        result = Reflect.get(h.data, fk, receiver)
    }
    else
      result = h
    return result
  }

  set(h: ObjectHandle, fk: FieldKey, value: any, receiver: any): boolean {
    const cs = Changeset.edit()
    const ov: ObjectVersion = cs.getEditableObjectVersion(h, fk, value)
    if (ov !== EMPTY_OBJECT_VERSION)
      cs.setFieldContent(h, fk, ov, value, receiver, Mvcc.sensitivity)
    else
      h.data[fk] = value
    return true
  }

  has(h: ObjectHandle, fk: FieldKey): boolean {
    const ov: ObjectVersion = Changeset.current().getObjectVersion(h, fk)
    return fk in ov.data || fk in h.data
  }

  defineProperty?(h: ObjectHandle, name: string | symbol, attributes: PropertyDescriptor): boolean {
    const result = attributes.get !== undefined && attributes.set !== undefined
    if (result)
      Object.defineProperty(h.data, name, attributes)
    return result
  }

  getOwnPropertyDescriptor(h: ObjectHandle, fk: FieldKey): PropertyDescriptor | undefined {
    const ov: ObjectVersion = Changeset.current().getObjectVersion(h, fk)
    const pd = Reflect.getOwnPropertyDescriptor(ov.data, fk)
    if (pd)
      pd.configurable = pd.writable = true
    return pd
  }

  ownKeys(h: ObjectHandle): Array<string | symbol> {
    // TODO: Better implementation to avoid filtering
    const ov: ObjectVersion = Changeset.current().getObjectVersion(h, Meta.Handle)
    const result = []
    for (const fk of Object.getOwnPropertyNames(ov.data)) {
      const field = ov.data[fk]
      if (!(field instanceof FieldVersion) || !field.isLaunch)
        result.push(fk)
    }
    return result
  }

  static decorateData(isObservable: boolean, proto: any, fk: FieldKey): any {
    if (isObservable) {
      Meta.acquire(proto, Meta.Initial)[fk] = new FieldVersion(undefined, 0)
      const get = function(this: any): any {
        const h = Mvcc.acquireHandle(this)
        return Mvcc.observable.get(h, fk, this)
      }
      const set = function(this: any, value: any): boolean {
        const h = Mvcc.acquireHandle(this)
        return Mvcc.observable.set(h, fk, value, this)
      }
      const enumerable = true
      const configurable = false
      return Object.defineProperty(proto, fk, { get, set, enumerable, configurable })
    }
    else
      Meta.acquire(proto, Meta.Initial)[fk] = Meta.Raw
  }

  static decorateOperation(implicit: boolean, decorator: Function,
    options: Partial<MemberOptions>, proto: any, member: FieldKey,
    pd: PropertyDescriptor | undefined): any {
    if (pd === undefined || pd === proto) // pd !== proto only for the first decorator in a chain
      pd = EMPTY_PROP_DESCRIPTOR
    const enumerable: boolean = pd.enumerable ?? true
    const configurable: boolean = pd.configurable ?? true
    const opts = Mvcc.rememberOperationOptions(proto, member,
      pd.value ?? pd.get, pd.value ?? pd.set, true, configurable, options, implicit)
    if (opts.getter === opts.setter) { // regular method
      const bootstrap = function(this: any): any {
        const h = Mvcc.acquireHandle(this)
        const operation = Mvcc.createOperation(h, member, opts)
        Object.defineProperty(h.data, member, { value: operation, enumerable, configurable })
        return operation
      }
      return Object.defineProperty(proto, member, { get: bootstrap, enumerable, configurable: true })
    }
    else if (opts.setter === UNDEF) { // property with getter only
      const bootstrap = function(this: any): any {
        const h = Mvcc.acquireHandle(this)
        const operation = Mvcc.createOperation(h, member, opts)
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
      return Mvcc.decorateOperation(false, decorator, options, proto, prop, pd) /* istanbul ignore next */
    }
  }

  static acquireHandle(obj: any): ObjectHandle {
    let h = obj[Meta.Handle]
    if (!h) {
      if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
        throw misuse("only objects can be observable")
      const initial = Meta.getFrom(Object.getPrototypeOf(obj), Meta.Initial)
      const ov = new ObjectVersion(EMPTY_OBJECT_VERSION.changeset, EMPTY_OBJECT_VERSION, {...initial})
      h = new ObjectHandle(obj, obj, Mvcc.observable, ov, obj.constructor.name)
      Meta.set(ov.data, Meta.Handle, h)
      Meta.set(obj, Meta.Handle, h)
      Meta.set(ov.data, Meta.Revision, new FieldVersion(1, 0))
    }
    return h
  }

  static createHandleForMvccObject(proto: any, data: any, blank: any, hint: string, isObservable: boolean): ObjectHandle {
    const ctx = Changeset.edit()
    const mvcc = isObservable ? Mvcc.observable : Mvcc.transactional
    const h = new ObjectHandle(data, undefined, mvcc, EMPTY_OBJECT_VERSION, hint)
    ctx.getEditableObjectVersion(h, Meta.Handle, blank)
    if (!Mvcc.reactivityAutoStartDisabled)
      for (const fk in Meta.getFrom(proto, Meta.Reactive))
        (h.proxy[fk][Meta.Controller] as Operation<any>).markObsolete()
    return h
  }

  static setProfilingMode(isOn: boolean, options?: Partial<ProfilingOptions>): void {
    if (isOn) {
      Mvcc.repetitiveUsageWarningThreshold = options && options.repetitiveUsageWarningThreshold !== undefined ? options.repetitiveUsageWarningThreshold : 10
      Mvcc.mainThreadBlockingWarningThreshold = options && options.mainThreadBlockingWarningThreshold !== undefined ? options.mainThreadBlockingWarningThreshold : 14
      Mvcc.asyncActionDurationWarningThreshold = options && options.asyncActionDurationWarningThreshold !== undefined ? options.asyncActionDurationWarningThreshold : 300
      Changeset.garbageCollectionSummaryInterval = options && options.garbageCollectionSummaryInterval !== undefined ? options.garbageCollectionSummaryInterval : 100
    }
    else {
      Mvcc.repetitiveUsageWarningThreshold = Number.MAX_SAFE_INTEGER
      Mvcc.mainThreadBlockingWarningThreshold = Number.MAX_SAFE_INTEGER
      Mvcc.asyncActionDurationWarningThreshold = Number.MAX_SAFE_INTEGER
      Changeset.garbageCollectionSummaryInterval = Number.MAX_SAFE_INTEGER
    }
  }

  static sensitive<T>(sensitivity: boolean, func: F<T>, ...args: any[]): T {
    const restore = Mvcc.sensitivity
    Mvcc.sensitivity = sensitivity
    try {
      return func(...args)
    }
    finally {
      Mvcc.sensitivity = restore
    }
  }

  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const h = Mvcc.acquireHandle(obj)
      h.hint = hint
    }
    return obj
  }

  static getHint<T>(obj: T): string {
    const h = Mvcc.acquireHandle(obj)
    return h.hint
  }

  /* istanbul ignore next */
  static createOperation = function(h: ObjectHandle, fk: FieldKey, options: OptionsImpl): F<any> {
    throw misuse("this implementation of createOperation should never be called")
  }

  /* istanbul ignore next */
  static rememberOperationOptions = function(proto: any, fk: FieldKey, getter: Function | undefined, setter: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<MemberOptions>, implicit: boolean): OptionsImpl {
    throw misuse("this implementation of rememberOperationOptions should never be called")
  }
}

const EMPTY_PROP_DESCRIPTOR: PropertyDescriptor = {
  configurable: true,
  enumerable: true,
  value: undefined,
}
