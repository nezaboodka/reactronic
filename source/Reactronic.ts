// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from './util/Utils'
import { Dbg } from './util/Dbg'
import { Cache } from './Cache'
import { Kind, Reentrance, CacheOptions, TraceOptions, ProfilingOptions, Sensitivity } from './Options'
import { Handle } from './impl/Data'
import { Snapshot } from './impl/Snapshot'
import { Hooks, decorateMethod } from './impl/Hooks'
import { Method } from './impl/Method'
import { Transaction } from './impl/Transaction'
import { TransactionJournal } from './impl/TransactionJournal'
import { Monitor } from './impl/Monitor'

export class Reactronic {
  static why(short: boolean = false): string { return short ? Method.whyShort() : Method.whyFull() }
  static getMethodCache<T>(method: F<T>): Cache<T> { return Method.getCache(method) }
  static configureCurrentMethodCache(options: Partial<CacheOptions>): CacheOptions { return Method.configureImpl(undefined, options) }
  // static configureObject<T extends object>(obj: T, options: Partial<ObjectOptions>): void { Hooks.setObjectOptions(obj, options) }
  // static assign<T, P extends keyof T>(obj: T, prop: P, value: T[P], sensitivity: Sensitivity): void { Hooks.assign(obj, prop, value, sensitivity) }
  static takeSnapshot<T>(obj: T): T { return Snapshot.takeSnapshot(obj) }
  static dispose(obj: any): void { Snapshot.dispose(obj) }
  // Configuration
  static get reactionsAutoStartDisabled(): boolean { return Hooks.reactionsAutoStartDisabled }
  static set reactionsAutoStartDisabled(value: boolean) { Hooks.reactionsAutoStartDisabled = value }
  // Trace
  static get isTraceEnabled(): boolean { return Dbg.isOn }
  static get traceOptions(): TraceOptions { return Dbg.trace }
  static setTraceMode(enabled: boolean, options?: TraceOptions): void { Dbg.setTraceMode(enabled, options) }
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Hooks.setHint(obj, name) }
  static getTraceHint<T extends object>(obj: T, full: boolean = false): string | undefined { return Handle.getHint(obj, full) }
  static setProfilingMode(enabled: boolean, options?: Partial<ProfilingOptions>): void { Hooks.setProfilingMode(enabled, options) }
}

// Operators

export function getCachedValueAndRevalidate<T>(method: F<Promise<T>>, args?: any[]): T | undefined {
  return Reactronic.getMethodCache(method as any as F<T>).getCachedValueAndRevalidate(args) // overcome type safety
}

export function unreactive<T>(func: F<T>, ...args: any[]): T {
  return Method.run<T>(undefined, func, ...args)
}

export function isolated<T>(func: F<T>, ...args: any[]): T {
  return Method.run<T>(undefined, Transaction.isolated, func, ...args)
}

export function sensitive<T>(sensitivity: Sensitivity, func: F<T>, ...args: any[]): T {
  return Hooks.sensitive(sensitivity, func, ...args)
}

// Decorators

// export function state(proto: object, prop: PropertyKey): any {
//   return Hooks.decorateField(true, proto, prop)
// }

export function unobservable(proto: object, prop: PropertyKey): any {
  return Hooks.decorateField(false, proto, prop)
}

export function transactional(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Transaction }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function reactive(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Reaction, throttling: -1 } // immediate reaction
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function cached(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Cache, noSideEffects: true }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function priority(value: number): F<any> {
  return decorateMethod({priority: value})
}

export function noSideEffects(value: boolean): F<any> {
  return decorateMethod({noSideEffects: value})
}

export function observableArgs(value: boolean): F<any> {
  return decorateMethod({sensitiveArgs: value})
}

export function throttling(milliseconds: number): F<any> {
  return decorateMethod({throttling: milliseconds})
}

export function reentrance(value: Reentrance): F<any> {
  return decorateMethod({reentrance: value})
}

export function journal(value: TransactionJournal | undefined): F<any> {
  return decorateMethod({journal: value})
}

export function monitor(value: Monitor | null): F<any> {
  return decorateMethod({monitor: value})
}

export function trace(value: Partial<TraceOptions>): F<any> {
  return decorateMethod({trace: value})
}
