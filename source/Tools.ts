// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F } from './util/Utils'
import { Dbg } from './util/Dbg'
import { Hints } from './impl/Snapshot'
import { Hooks, options } from './impl/Hooks'
import { Method } from './impl/Reactivity'
import { Transaction, Cache, Monitor, Kind, Reentrance, Trace, ProfilingOptions } from 'reactronic'

export class Reactronic {
  // Configuration
  static get triggersAutoStartDisabled(): boolean { return Hooks.triggersAutoStartDisabled }
  static set triggersAutoStartDisabled(value: boolean) { Hooks.triggersAutoStartDisabled = value }
  // Tracing
  static get isTraceOn(): boolean { return Dbg.isOn }
  static get trace(): Trace { return Dbg.trace }
  static setTrace(t: Trace | undefined): void { Dbg.global = t || Dbg.OFF; Dbg.isOn = t !== undefined }
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Hints.setHint(obj, name) }
  static getTraceHint<T extends object>(obj: T): string | undefined { return Hints.getHint(obj) }
  static setProfilingMode(enabled: boolean, options?: Partial<ProfilingOptions>): void { Hooks.setProfilingMode(enabled, options) }
  static why(): string { return Method.why() }
}

// Operators

export function getCachedAndRevalidate<T>(method: F<Promise<T>>, args?: any[]): T | undefined {
  return Cache.of(method as any as F<T>).getCachedAndRevalidate(args) // overcome type safety
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
  const opt = { kind: Kind.Cached }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function priority(priority: number): F<any> {
  return options({priority})
}

export function incentiveArgs(incentiveArgs: boolean): F<any> {
  return options({incentiveArgs})
}

export function throttling(throttling: number): F<any> {
  return options({throttling})
}

export function reentrance(reentrance: Reentrance): F<any> {
  return options({reentrance})
}

export function monitor(monitor: Monitor | null): F<any> {
  return options({monitor})
}

export function trace(trace: Partial<Trace>): F<any> {
  return options({trace})
}
