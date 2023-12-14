// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2023 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from './util/Utils.js'
import { Log } from './util/Dbg.js'
import {AbstractReaction, Kind, MemberOptions, LoggingOptions, ProfilingOptions } from './Options.js'
import { Meta, ObjectHandle } from './core/Data.js'
import { Changeset } from './core/Changeset.js'
import { Mvcc } from './core/Mvcc.js'
import { Transaction } from './core/Transaction.js'
import { ReactionImpl } from './core/Reaction.js'

export class RxSystem {
  static why(brief: boolean = false): string { return brief ? ReactionImpl.briefWhy() : ReactionImpl.why() }
  static getReaction<T>(method: F<T>): AbstractReaction<T> { return ReactionImpl.getControllerOf(method) }
  static pullLastResult<T>(method: F<Promise<T>>, args?: any[]): T | undefined { return RxSystem.getReaction(method as any as F<T>).pullLastResult(args) }
  static configureCurrentOperation(options: Partial<MemberOptions>): MemberOptions { return ReactionImpl.configureImpl(undefined, options) }
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

export function transaction<T>(action: F<T>, ...args: any[]): T {
  return Transaction.run(null, action, ...args)
}

export function unobs<T>(func: F<T>, ...args: any[]): T {
  return ReactionImpl.proceedWithinGivenLaunch<T>(undefined, func, ...args)
}

export function sensitive<T>(sensitivity: boolean, func: F<T>, ...args: any[]): T {
  return Mvcc.sensitive(sensitivity, func, ...args)
}

// Decorators

export function raw(proto: object, prop: PropertyKey): any {
  return Mvcc.decorateData(false, proto, prop)
}

export function obs(proto: object, prop: PropertyKey): any {
  return Mvcc.decorateData(true, proto, prop)
}

export function transactional(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = { kind: Kind.Transactional }
  return Mvcc.decorateOperation(true, transactional, opts, proto, prop, pd)
}

export function reactive(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = { kind: Kind.Reactive, throttling: -1 } // immediate reactive call
  return Mvcc.decorateOperation(true, reactive, opts, proto, prop, pd)
}

export function cached(proto: object, prop: PropertyKey, pd: PropertyDescriptor): any {
  const opts = { kind: Kind.Cached, noSideEffects: true }
  return Mvcc.decorateOperation(true, cached, opts, proto, prop, pd)
}

export function options(value: Partial<MemberOptions>): F<any> {
  return Mvcc.decorateOperationParametrized(options, value)
}
