// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from './util/Utils'
import { Dbg } from './util/Dbg'
import { Controller } from './Controller'
import { Kind, Reentrance, MethodOptions, TraceOptions, ProfilingOptions, Sensitivity } from './Options'
import { ObjectHolder } from './impl/Data'
import { Snapshot } from './impl/Snapshot'
import { Hooks, decorateMethod } from './impl/Hooks'
import { TaskCtl } from './impl/TaskCtl'
import { Operation } from './impl/Operation'
import { OperationJournal } from './impl/OperationJournal'
import { Monitor } from './impl/Monitor'

export class Reactronic {
  static why(brief: boolean = false): string { return brief ? TaskCtl.briefWhy() : TaskCtl.why() }
  static getController<T>(method: F<T>): Controller<T> { return TaskCtl.of(method) }
  static pullLastResult<T>(method: F<Promise<T>>, args?: any[]): T | undefined { return Reactronic.getController(method as any as F<T>).pullLastResult(args) }
  static configureCurrentMethod(options: Partial<MethodOptions>): MethodOptions { return TaskCtl.configureImpl(undefined, options) }
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
  static getTraceHint<T extends object>(obj: T, full: boolean = false): string | undefined { return ObjectHolder.getHint(obj, full) }
  static setProfilingMode(enabled: boolean, options?: Partial<ProfilingOptions>): void { Hooks.setProfilingMode(enabled, options) }
}

// Operators

export function nonreactiveRun<T>(func: F<T>, ...args: any[]): T {
  return TaskCtl.run<T>(undefined, func, ...args)
}

export function isolatedRun<T>(func: F<T>, ...args: any[]): T {
  return TaskCtl.run<T>(undefined, Operation.isolated, func, ...args)
}

export function sensitiveRun<T>(sensitivity: Sensitivity, func: F<T>, ...args: any[]): T {
  return Hooks.sensitive(sensitivity, func, ...args)
}

// Decorators

// export function state(proto: object, prop: PropertyKey): any {
//   return Hooks.decorateField(true, proto, prop)
// }

export function plain(proto: object, prop: PropertyKey): any {
  return Hooks.decorateField(false, proto, prop)
}

export function operation(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opt = { kind: Kind.Operation }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function reaction(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opt = { kind: Kind.Reaction, throttling: -1 } // immediate reaction
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function cached(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
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

export function journal(value: OperationJournal | undefined): F<any> {
  return decorateMethod({journal: value})
}

export function monitor(value: Monitor | null): F<any> {
  return decorateMethod({monitor: value})
}

export function trace(value: Partial<TraceOptions>): F<any> {
  return decorateMethod({trace: value})
}
