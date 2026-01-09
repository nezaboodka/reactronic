// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Log, misuse } from "./util/Dbg.js"
import { F } from "./util/Utils.js"
import { Kind, Isolation } from "./Enums.js"
import { Reaction, ReactivityOptions, LoggingOptions, ProfilingOptions, SnapshotOptions } from "./Options.js"
import { Meta, ObjectHandle } from "./core/Data.js"
import { Changeset } from "./core/Changeset.js"
import { Mvcc } from "./core/Mvcc.js"
import { Transaction } from "./core/Transaction.js"
import { ReactionImpl } from "./core/Operation.js"

export class ReactiveSystem {
  static why(brief: boolean = false): string { return brief ? ReactionImpl.briefWhy() : ReactionImpl.why() }
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

export function runTransactional<T>(func: F<T>, ...args: any[]): T
export function runTransactional<T>(options: SnapshotOptions, func: F<T>, ...args: any[]): T
export function runTransactional<T>(
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

export function runNonReactive<T>(func: F<T>, ...args: any[]): T {
  return ReactionImpl.proceedWithinGivenLaunch<T>(undefined, func, ...args)
}

export function runSensitive<T>(sensitivity: boolean, func: F<T>, ...args: any[]): T {
  return Mvcc.sensitive(sensitivity, func, ...args)
}

export function runContextual<T>(p: Promise<T>): Promise<T> {
  throw misuse("not implemented yet")
}

export function manageReaction<T>(method: F<T>): Reaction<T> {
  return ReactionImpl.manageReaction(method)
}

export function configureCurrentReaction(options: Partial<ReactivityOptions>): ReactivityOptions {
  return ReactionImpl.configureImpl(undefined, options)
}

export function disposeRxObject(obj: any): void {
  Changeset.dispose(obj)
}

// Decorators

export function signal(enabled: boolean): (proto: object, prop: PropertyKey) => any
export function signal<T>(proto: object, prop: PropertyKey): any
export function signal<T>(protoOrEnabled: object | boolean, prop?: PropertyKey): any | ((proto: object, prop: PropertyKey) => any) {
  if (typeof(protoOrEnabled) === "boolean") {
    return (proto: T, prop: PropertyKey) => {
      return Mvcc.decorateData(protoOrEnabled, proto, prop)
    }
  }
  else
    return Mvcc.decorateData(true, protoOrEnabled, prop!)
}

export function transaction(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any
{
  const opts = {
    kind: Kind.transaction,
    isolation: Isolation.joinToCurrentTransaction,
  }
  return Mvcc.decorateOperation(true, transaction, opts, proto, prop, pd)
}

export function reaction(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = {
    kind: Kind.reaction,
    isolation: Isolation.joinAsNestedTransaction,
    throttling: -1, // immediate reactive call
  }
  return Mvcc.decorateOperation(true, reaction, opts, proto, prop, pd)
}

export function cache(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = {
    kind: Kind.cache,
    isolation: Isolation.joinToCurrentTransaction,
    noSideEffects: true,
  }
  return Mvcc.decorateOperation(true, cache, opts, proto, prop, pd)
}

export function options(value: Partial<ReactivityOptions>): F<any> {
  return Mvcc.decorateOperationParametrized(options, value)
}
