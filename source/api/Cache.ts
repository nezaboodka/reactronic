// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { CacheImpl, F, Handle, Dbg } from '../internal/all';
import { Transaction } from './Transaction';
import { Config, Trace } from './Config';

export function cacheof<T>(method: F<T>): Cache<T> {
  return Cache.of<T>(method);
}

export function resolved<T>(method: F<Promise<T>>, args?: any[]): T | undefined {
  return (cacheof(method) as any).call(args);
}

export function nonreactive<T>(func: F<T>, ...args: any[]): T {
  return CacheImpl.run<T>(undefined, func, ...args);
}

export function standalone<T>(func: F<T>, ...args: any[]): T {
  return CacheImpl.run<T>(undefined, Transaction.outside, func, ...args);
}

export abstract class Cache<T> {
  abstract configure(config: Partial<Config>): Config;
  abstract readonly config: Config;
  abstract readonly stamp: number;
  abstract readonly args: ReadonlyArray<any>;
  abstract readonly value: T;
  abstract readonly error: any;
  abstract readonly isInvalid: boolean;
  abstract invalidate(): void;
  abstract call(args?: any[]): T | undefined;

  static get triggersAutoStartDisabled(): boolean { return CacheImpl.triggersAutoStartDisabled; }
  static set triggersAutoStartDisabled(value: boolean) { CacheImpl.triggersAutoStartDisabled = value; }
  static of<T>(method: F<T>): Cache<T> { return CacheImpl.get(method); }
  static unmount(...objects: any[]): Transaction { return CacheImpl.unmount(...objects); }

  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Handle.setHint(obj, name); }
  static getTraceHint<T extends object>(obj: T): string | undefined { return Handle.getHint(obj); }
  static setTrace(t: Trace | undefined) { Dbg.global = t || Dbg.OFF; Dbg.isOn = t !== undefined; }
  static get trace(): Trace { return Dbg.trace; }
  static get isTraceOn(): boolean { return Dbg.isOn; }
}
