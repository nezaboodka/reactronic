// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from './util/Utils'
import { Dbg } from './util/Dbg'
import { Cache } from './Cache'
import { Kind, Reentrance, CacheOptions, LoggingOptions, ProfilingOptions, Sensitivity } from './Options'
import { Handle } from './impl/Data'
import { Snapshot } from './impl/Snapshot'
import { Hooks, decorateMethod } from './impl/Hooks'
import { Method } from './impl/Method'
import { Transaction } from './impl/Transaction'
import { UndoRedoLog } from './impl/UndoRedoLog'
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
  static get triggersAutoStartDisabled(): boolean { return Hooks.triggersAutoStartDisabled }
  static set triggersAutoStartDisabled(value: boolean) { Hooks.triggersAutoStartDisabled = value }
  // Logging
  static get isLogging(): boolean { return Dbg.isOn }
  static get loggingOptions(): LoggingOptions { return Dbg.logging }
  static setLoggingMode(enabled: boolean, options?: LoggingOptions): void { Dbg.setLoggingMode(enabled, options) }
  static setLoggingHint<T extends object>(obj: T, name: string | undefined): void { Hooks.setHint(obj, name) }
  static getLoggingHint<T extends object>(obj: T, full: boolean = false): string | undefined { return Handle.getHint(obj, full) }
  static setProfilingMode(enabled: boolean, options?: Partial<ProfilingOptions>): void { Hooks.setProfilingMode(enabled, options) }
}

// Operators

export function getCachedAndRevalidate<T>(method: F<Promise<T>>, args?: any[]): T | undefined {
  return Reactronic.getMethodCache(method as any as F<T>).getCachedAndRevalidate(args) // overcome type safety
}

export function untracked<T>(func: F<T>, ...args: any[]): T {
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

export function stateless(proto: object, prop: PropertyKey): any {
  return Hooks.decorateField(false, proto, prop)
}

export function transaction(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Transaction }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function trigger(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Trigger, throttling: -1 } // immediate trigger
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function cached(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Cached, noSideEffects: true }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function priority(value: number): F<any> {
  return decorateMethod({priority: value})
}

export function noSideEffects(value: boolean): F<any> {
  return decorateMethod({noSideEffects: value})
}

export function sensitiveArgs(value: boolean): F<any> {
  return decorateMethod({sensitiveArgs: value})
}

export function throttling(milliseconds: number): F<any> {
  return decorateMethod({throttling: milliseconds})
}

export function reentrance(value: Reentrance): F<any> {
  return decorateMethod({reentrance: value})
}

export function undoRedoLog(value: UndoRedoLog | undefined): F<any> {
  return decorateMethod({undoRedoLog: value})
}

export function monitor(value: Monitor | null): F<any> {
  return decorateMethod({monitor: value})
}

export function logging(value: Partial<LoggingOptions>): F<any> {
  return decorateMethod({logging: value})
}
