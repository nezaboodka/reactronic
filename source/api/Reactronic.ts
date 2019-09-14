// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { MethodCache, F, Handle, Dbg } from '../internal/all';
import { Transaction } from './Transaction';
import { Config, Trace } from './Config';

export function resultof<T>(method: F<Promise<T>>, ...args: any[]): T | undefined {
  return (statusof(method) as any).getResult(...args);
}

export function statusof<T>(method: F<T>): Reactronic<T> {
  return Reactronic.get<T>(method);
}

export abstract class Reactronic<T> {
  abstract readonly config: Config;
  abstract configure(config: Partial<Config>): Config;
  abstract readonly stamp: number;
  abstract readonly error: any;
  abstract getResult(...args: any[]): T | undefined;
  abstract readonly isInvalid: boolean;
  abstract invalidate(cause: string | undefined): boolean;

  static get<T>(method: F<T>): Reactronic<T> { return MethodCache.get(method); }
  static unmount(...objects: any[]): Transaction { return MethodCache.unmount(...objects); }

  static get trace(): Trace { return Dbg.trace; }
  static set trace(value: Trace) { Dbg.trace = value as any; }
  static pushTrace(t: Partial<Trace>): Trace { Dbg.push(t, undefined); return Dbg.trace; }
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Handle.setHint(obj, name); }
  static getTraceHint<T extends object>(obj: T): string | undefined { return Handle.getHint(obj); }
}
