// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from './util/Utils'
import { Dbg } from './util/Dbg'
import { Controller } from './Controller'
import { Kind, MemberOptions, TraceOptions, ProfilingOptions, Sensitivity } from './Options'
import { ObjectHolder } from './impl/Data'
import { Snapshot } from './impl/Snapshot'
import { Hooks } from './impl/Hooks'
import { OperationController } from './impl/Operation'
import { Transaction } from './impl/Transaction'

export class Reactronic {
  static why(brief: boolean = false): string { return brief ? OperationController.briefWhy() : OperationController.why() }
  static getController<T>(method: F<T>): Controller<T> { return OperationController.of(method) }
  static pullLastResult<T>(method: F<Promise<T>>, args?: any[]): T | undefined { return Reactronic.getController(method as any as F<T>).pullLastResult(args) }
  static configureCurrentMethod(options: Partial<MemberOptions>): MemberOptions { return OperationController.configureImpl(undefined, options) }
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

export function nonreactive<T>(func: F<T>, ...args: any[]): T {
  return OperationController.runWithin<T>(undefined, func, ...args)
}

export function standalone<T>(func: F<T>, ...args: any[]): T {
  return OperationController.runWithin<T>(undefined, Transaction.standalone, func, ...args)
}

export function sensitive<T>(sensitivity: Sensitivity, func: F<T>, ...args: any[]): T {
  return Hooks.sensitive(sensitivity, func, ...args)
}

// Decorators

export function unobservable(proto: object, prop: PropertyKey): any {
  return Hooks.decorateData(false, proto, prop)
}

export function transaction(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = { kind: Kind.Transaction }
  return Hooks.decorateOperation(true, transaction, opts, proto, prop, pd)
}

export function reaction(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = { kind: Kind.Reaction, throttling: -1 } // immediate reaction
  return Hooks.decorateOperation(true, reaction, opts, proto, prop, pd)
}

export function cached(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = { kind: Kind.Cache, noSideEffects: true }
  return Hooks.decorateOperation(true, cached, opts, proto, prop, pd)
}

export function options(value: Partial<MemberOptions>): F<any> {
  return Hooks.decorateOperationParametrized(options, value)
}
