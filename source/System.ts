// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Log, misuse } from "./util/Dbg.js"
import { F } from "./util/Utils.js"
import { Kind, Isolation } from "./Enums.js"
import { ReactiveOperation, ReactivityOptions, LoggingOptions, ProfilingOptions, SnapshotOptions } from "./Options.js"
import { Meta, ObjectHandle } from "./core/Data.js"
import { Changeset } from "./core/Changeset.js"
import { Mvcc } from "./core/Mvcc.js"
import { Transaction } from "./core/Transaction.js"
import { ReactiveOperationImpl } from "./core/Operation.js"

export class ReactiveSystem {
  static why(brief: boolean = false): string { return brief ? ReactiveOperationImpl.briefWhy() : ReactiveOperationImpl.why() }
  static getRevisionOf(obj: any): number { return obj[Meta.Revision] }
  static takeSnapshot<T>(obj: T): T { return Changeset.takeSnapshot(obj) }
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

export function runAtomically<T>(func: F<T>, ...args: any[]): T
export function runAtomically<T>(options: SnapshotOptions, func: F<T>, ...args: any[]): T
export function runAtomically<T>(
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

export function runNonReactively<T>(func: F<T>, ...args: any[]): T {
  return ReactiveOperationImpl.proceedWithinGivenLaunch<T>(undefined, func, ...args)
}

export function runSensitively<T>(sensitivity: boolean, func: F<T>, ...args: any[]): T {
  return Mvcc.sensitive(sensitivity, func, ...args)
}

export function runContextually<T>(p: Promise<T>): Promise<T> {
  throw misuse("not implemented yet")
}

export function manageReactiveOperation<T>(method: F<T>): ReactiveOperation<T> {
  return ReactiveOperationImpl.manageReactiveOperation(method)
}

export function configureCurrentReactiveOperation(options: Partial<ReactivityOptions>): ReactivityOptions {
  return ReactiveOperationImpl.configureImpl(undefined, options)
}

export function disposeObservableObject(obj: any): void {
  Changeset.dispose(obj)
}

// Decorators

export function observable(enabled: boolean): (proto: object, prop: PropertyKey) => any
export function observable<T>(proto: object, prop: PropertyKey): any
export function observable<T>(protoOrEnabled: object | boolean, prop?: PropertyKey): any | ((proto: object, prop: PropertyKey) => any) {
  if (typeof(protoOrEnabled) === "boolean") {
    return (proto: T, prop: PropertyKey) => {
      return Mvcc.decorateData(protoOrEnabled, proto, prop)
    }
  }
  else
    return Mvcc.decorateData(true, protoOrEnabled, prop!)
}

export function atomic(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any
{
  const opts = {
    kind: Kind.atomic,
    isolation: Isolation.joinToCurrentTransaction,
  }
  return Mvcc.decorateOperation(true, atomic, opts, proto, prop, pd)
}

export function reactive(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = {
    kind: Kind.reactive,
    isolation: Isolation.joinAsNestedTransaction,
    throttling: -1, // immediate reactive call
  }
  return Mvcc.decorateOperation(true, reactive, opts, proto, prop, pd)
}

export function cached(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = {
    kind: Kind.cached,
    isolation: Isolation.joinToCurrentTransaction,
    noSideEffects: true,
  }
  return Mvcc.decorateOperation(true, cached, opts, proto, prop, pd)
}

export function options(value: Partial<ReactivityOptions>): F<any> {
  return Mvcc.decorateOperationParametrized(options, value)
}
