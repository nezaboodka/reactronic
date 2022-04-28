// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from './util/Utils'
import { Log } from './util/Dbg'
import { Controller } from './Controller'
import { Kind, MemberOptions, LoggingOptions, ProfilingOptions } from './Options'
import { DataHolder } from './impl/Data'
import { Snapshot } from './impl/Snapshot'
import { Hooks } from './impl/Hooks'
import { OperationController } from './impl/Operation'

export class Rx {
  static why(brief: boolean = false): string { return brief ? OperationController.briefWhy() : OperationController.why() }
  static getController<T>(method: F<T>): Controller<T> { return OperationController.of(method) }
  static pullLastResult<T>(method: F<Promise<T>>, args?: any[]): T | undefined { return Rx.getController(method as any as F<T>).pullLastResult(args) }
  static configureCurrentOperation(options: Partial<MemberOptions>): MemberOptions { return OperationController.configureImpl(undefined, options) }
  // static configureObject<T extends object>(obj: T, options: Partial<ObjectOptions>): void { Hooks.setObjectOptions(obj, options) }
  // static assign<T, P extends keyof T>(obj: T, prop: P, value: T[P], sensitivity: Sensitivity): void { Hooks.assign(obj, prop, value, sensitivity) }
  static takeSnapshot<T>(obj: T): T { return Snapshot.takeSnapshot(obj) }
  static dispose(obj: any): void { Snapshot.dispose(obj) }
  // Configuration
  static get reactionsAutoStartDisabled(): boolean { return Hooks.reactionsAutoStartDisabled }
  static set reactionsAutoStartDisabled(value: boolean) { Hooks.reactionsAutoStartDisabled = value }
  // Logging
  static get isLogging(): boolean { return Log.isOn }
  static get loggingOptions(): LoggingOptions { return Log.opt }
  static setLoggingMode(isOn: boolean, options?: LoggingOptions): void { Log.setMode(isOn, options) }
  static setLoggingHint<T extends object>(obj: T, name: string | undefined): void { Hooks.setHint(obj, name) }
  static getLoggingHint<T extends object>(obj: T, full: boolean = false): string | undefined { return DataHolder.getHint(obj, full) }
  static setProfilingMode(isOn: boolean, options?: Partial<ProfilingOptions>): void { Hooks.setProfilingMode(isOn, options) }
}

// Operators

export function nonreactive<T>(func: F<T>, ...args: any[]): T {
  return OperationController.runWithin<T>(undefined, func, ...args)
}

export function sensitive<T>(sensitivity: boolean, func: F<T>, ...args: any[]): T {
  return Hooks.sensitive(sensitivity, func, ...args)
}

// Decorators

export function isnonreactive(proto: object, prop: PropertyKey): any {
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
