// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F } from './util/Utils'
import { Dbg } from './util/Dbg'
import { Hints } from './impl/Snapshot'
import { Hooks, options } from './impl/Hooks'
import { Method } from './impl/Reactivity'
import { Action, Cache, Monitor, Kind, Reentrance, Trace } from 'reactronic'

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
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Hints.setHint(obj, name) }
  static getTraceHint<T extends object>(obj: T): string | undefined { return Hints.getHint(obj) }
}

// Operators

export function getCachedResultAndRevalidate<T>(method: F<Promise<T>>, args?: any[]): T | undefined {
  return Cache.of(method as any as F<T>).getCachedResultAndRevalidate(args) // overcome type safety
}

export function nonreactive<T>(func: F<T>, ...args: any[]): T {
  return Method.run<T>(undefined, func, ...args)
}

export function separate<T>(func: F<T>, ...args: any[]): T {
  return Method.run<T>(undefined, Action.off, func, ...args)
}

// Decorators

export function state(proto: object, prop: PropertyKey): any {
  return Hooks.decorateField(true, proto, prop)
}

export function stateless(proto: object, prop: PropertyKey): any {
  return Hooks.decorateField(false, proto, prop)
}

export function action(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Action }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function trigger(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Trigger, delay: -1 } // immediate trigger
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function cached(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Cached }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function cachedArgs(cachedArgs: boolean): F<any> {
  return options({cachedArgs})
}

export function delay(delay: number): F<any> {
  return options({delay})
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
