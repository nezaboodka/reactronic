// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from "./util/Utils.js"
import { Log } from "./util/Dbg.js"
import { Operation, Kind, MemberOptions, LoggingOptions, ProfilingOptions, Isolation, SnapshotOptions } from "./Options.js"
import { Meta, ObjectHandle } from "./core/Data.js"
import { Changeset } from "./core/Changeset.js"
import { Mvcc } from "./core/Mvcc.js"
import { Transaction } from "./core/Transaction.js"
import { OperationImpl } from "./core/Operation.js"

export class ReactiveSystem {
  static why(brief: boolean = false): string { return brief ? OperationImpl.briefWhy() : OperationImpl.why() }
  static getOperation<T>(method: F<T>): Operation<T> { return OperationImpl.getControllerOf(method) }
  static pullLastResult<T>(method: F<Promise<T>>, args?: any[]): T | undefined { return ReactiveSystem.getOperation(method as any as F<T>).pullLastResult(args) }
  static configureCurrentOperation(options: Partial<MemberOptions>): MemberOptions { return OperationImpl.configureImpl(undefined, options) }
  // static configureObject<T extends object>(obj: T, options: Partial<ObjectOptions>): void { Mvcc.setObjectOptions(obj, options) }
  static getRevisionOf(obj: any): number { return obj[Meta.Revision] }
  static takeSnapshot<T>(obj: T): T { return Changeset.takeSnapshot(obj) }
  static dispose(obj: any): void { Changeset.dispose(obj) }
  // Configuration
  static get reactivityAutoStartDisabled(): boolean { return Mvcc.reactivityAutoStartDisabled }
  static set reactivityAutoStartDisabled(value: boolean) { Mvcc.reactivityAutoStartDisabled = value }
  // Logging
  static get isLogging(): boolean { return Log.isOn }
  static get loggingOptions(): LoggingOptions { return Log.opt }
  static setLoggingMode(isOn: boolean, options?: LoggingOptions): void { Log.setMode(isOn, options) }
  static setLoggingHint<T extends object>(obj: T, name: string | undefined): void { Mvcc.setHint(obj, name) }
  static getLoggingHint<T extends object>(obj: T, full: boolean = false): string | undefined { return ObjectHandle.getHint(obj, full) }
  static setProfilingMode(isOn: boolean, options?: Partial<ProfilingOptions>): void { Mvcc.setProfilingMode(isOn, options) }
}

// Operators

export function atomically<T>(func: F<T>, ...args: any[]): T
export function atomically<T>(options: SnapshotOptions, func: F<T>, ...args: any[]): T
export function atomically<T>(
  p1: F<T> | SnapshotOptions,
  p2: any[] | F<T>,
  p3: undefined | any[]): T {
  if (p1 instanceof Function) {
    // atomically<T>(func: F<T>, ...args: any[]): T
    if (p2 !== undefined)
      return Transaction.run(null, p1, ...(p2 as any[]))
    else
      return Transaction.run(null, p1)
  }
  else { // p2 instanceof Function
    // atomically<T>(options: SnapshotOptions, func: F<T>, ...args: any[]): T
    if (p3 !== undefined)
      return Transaction.run(p1, p2 as F<T>, ...(p3 as any[]))
    else
      return Transaction.run(p1, p2 as F<T>)
  }
}

export function nonreactive<T>(func: F<T>, ...args: any[]): T {
  return OperationImpl.proceedWithinGivenLaunch<T>(undefined, func, ...args)
}

export function sensitive<T>(sensitivity: boolean, func: F<T>, ...args: any[]): T {
  return Mvcc.sensitive(sensitivity, func, ...args)
}

export function contextually<T>(p: Promise<T>): Promise<T> {
  throw new Error("not implemented yet")
}

// Decorators

export function unobservable(proto: object, prop: PropertyKey): any {
  return Mvcc.decorateData(false, proto, prop)
}

export function observable(proto: object, prop: PropertyKey): any {
  return Mvcc.decorateData(true, proto, prop)
}

export function atomicAction(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any
{
  const opts = {
    kind: Kind.atomicAction,
    isolation: Isolation.joinToCurrentTransaction,
  }
  return Mvcc.decorateOperation(true, atomicAction, opts, proto, prop, pd)
}

export function reactiveProcess(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = {
    kind: Kind.reactiveProcess,
    isolation: Isolation.joinAsNestedTransaction,
    throttling: -1, // immediate reactive call
  }
  return Mvcc.decorateOperation(true, reactiveProcess, opts, proto, prop, pd)
}

export function cachedResult(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = {
    kind: Kind.cachedResult,
    isolation: Isolation.joinToCurrentTransaction,
    noSideEffects: true,
  }
  return Mvcc.decorateOperation(true, cachedResult, opts, proto, prop, pd)
}

export function options(value: Partial<MemberOptions>): F<any> {
  return Mvcc.decorateOperationParametrized(options, value)
}
