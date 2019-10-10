// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F } from './util/Utils'
import { Dbg } from './util/Dbg'
import { Action, Cache, Indicator, Kind, Reentrance, Trace } from './.index'
import { CacheImpl, Hooks, options, Hint } from './impl/.index'

export class Tools {
  // Configuration
  static get triggersAutoStartDisabled(): boolean { return Hooks.triggersAutoStartDisabled }
  static set triggersAutoStartDisabled(value: boolean) { Hooks.triggersAutoStartDisabled = value }
  static get performanceWarningThreshold(): number { return Hooks.performanceWarningThreshold }
  static set performanceWarningThreshold(value: number) { Hooks.performanceWarningThreshold = value }
  // Tracing
  static get isTraceOn(): boolean { return Dbg.isOn }
  static get trace(): Trace { return Dbg.trace }
  static setTrace(t: Trace | undefined): void { Dbg.global = t || Dbg.OFF; Dbg.isOn = t !== undefined }
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Hint.setHint(obj, name) }
  static getTraceHint<T extends object>(obj: T): string | undefined { return Hint.getHint(obj) }
}

// Operators

export function cacheof<T>(method: F<T>): Cache<T> {
  return Cache.of<T>(method)
}

export function resolved<T>(method: F<Promise<T>>, args?: any[]): T | undefined {
  return (cacheof(method) as any).call(args)
}

export function nonreactive<T>(func: F<T>, ...args: any[]): T {
  return CacheImpl.runAs<T>(undefined, func, ...args)
}

export function standalone<T>(func: F<T>, ...args: any[]): T {
  return CacheImpl.runAs<T>(undefined, Action.outside, func, ...args)
}

// Decorators

export function stateful(proto: object, prop?: PropertyKey): any {
  const opt = { kind: Kind.Stateful }
  return prop ? Hooks.decorateField(true, opt, proto, prop) : Hooks.decorateClass(true, opt, proto)
}

export function stateless(proto: object, prop: PropertyKey): any {
  const opt = { kind: Kind.Stateless }
  return Hooks.decorateField(true, opt, proto, prop)
}

export function action(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Action }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function trigger(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Trigger, latency: -1 } // immediate trigger
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function cached(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Cached }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function latency(latency: number): F<any> {
  return options({latency})
}

export function reentrance(reentrance: Reentrance): F<any> {
  return options({reentrance})
}

export function cachedArgs(cachedArgs: boolean): F<any> {
  return options({cachedArgs})
}

export function indicator(indicator: Indicator | null): F<any> {
  return options({indicator})
}

export function trace(trace: Partial<Trace>): F<any> {
  return options({trace})
}
