// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F } from './util/Utils'
import { Dbg } from './util/Dbg'
import { Snapshot } from './impl/Snapshot'
import { Hooks, options } from './impl/Hooks'
import { Method } from './impl/Reactivity'
import { Transaction } from './Transaction'
import { Cache } from './Cache'
import { Monitor } from './Monitor'
import { Kind, Reentrance, Options, LoggingOptions, ProfilingOptions, Sensitivity } from './Options'

export class Reactronic {
  static why(): string { return Method.why() }
  static getCache<T>(method: F<T>): Cache<T> { return Method.getCache(method) }
  static configureCache(options: Partial<Options>): Options { return Method.configureImpl(undefined, options) }
  // static configureObject<T extends object>(obj: T, options: Partial<ObjectOptions>): void { Hooks.setObjectOptions(obj, options) }
  static assign<T, P extends keyof T>(sensitivity: Sensitivity, obj: T, prop: P, value: T[P]): void { Hooks.assign(sensitivity, obj, prop, value) }
  static unmount(obj: any): void { Snapshot.unmount(obj) }
  // Configuration
  static get triggersAutoStartDisabled(): boolean { return Hooks.triggersAutoStartDisabled }
  static set triggersAutoStartDisabled(value: boolean) { Hooks.triggersAutoStartDisabled = value }
  // Logging
  static get isLogging(): boolean { return Dbg.isOn }
  static get loggingOptions(): LoggingOptions { return Dbg.logging }
  static setLoggingMode(enabled: boolean, options?: LoggingOptions): void { Dbg.setLoggingMode(enabled, options) }
  static setLoggingHint<T extends object>(obj: T, name: string | undefined): void { Hooks.setHint(obj, name) }
  static getLoggingHint<T extends object>(obj: T, full: boolean = false): string | undefined { return Hooks.getHint(obj, full) }
  static setProfilingMode(enabled: boolean, options?: Partial<ProfilingOptions>): void { Hooks.setProfilingMode(enabled, options) }
}

// Operators

export function getCachedAndRevalidate<T>(method: F<Promise<T>>, args?: any[]): T | undefined {
  return Reactronic.getCache(method as any as F<T>).getCachedAndRevalidate(args) // overcome type safety
}

export function nonreactive<T>(func: F<T>, ...args: any[]): T {
  return Method.run<T>(undefined, func, ...args)
}

export function isolated<T>(func: F<T>, ...args: any[]): T {
  return Method.run<T>(undefined, Transaction.isolated, func, ...args)
}

// Decorators

export function state(proto: object, prop: PropertyKey): any {
  return Hooks.decorateField(true, proto, prop)
}

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
  return options({priority: value})
}

export function noSideEffects(value: boolean): F<any> {
  return options({noSideEffects: value})
}

export function sensitiveArgs(value: boolean): F<any> {
  return options({sensitiveArgs: value})
}

export function throttling(milliseconds: number): F<any> {
  return options({throttling: milliseconds})
}

export function reentrance(value: Reentrance): F<any> {
  return options({reentrance: value})
}

export function monitor(value: Monitor | null): F<any> {
  return options({monitor: value})
}

export function logging(value: Partial<LoggingOptions>): F<any> {
  return options({logging: value})
}
