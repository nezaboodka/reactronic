// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Cache, F, Handle, Dbg } from '../internal/all';
import { Transaction } from './Transaction';
import { Reactivity, Trace } from './Reactivity';

export function resultof<T>(method: F<Promise<T>>, args?: any[]): T | undefined {
  return (statusof(method) as any).getResult(args);
}

export function statusof<T>(method: F<T>): Status<T> {
  return Status.get<T>(method);
}

export function offstage<T>(func: F<T>, ...args: any[]): T {
  return Cache.run<T>(undefined, Transaction.off, func, ...args);
}

export abstract class Status<T> {
  abstract readonly reactivity: Reactivity;
  abstract configure(reactivity: Partial<Reactivity>): Reactivity;
  abstract readonly args: ReadonlyArray<any>;
  abstract readonly stamp: number;
  abstract readonly error: any;
  abstract getResult(args?: any[]): T | undefined;
  abstract readonly isInvalid: boolean;
  abstract invalidate(): void;

  static get<T>(method: F<T>): Status<T> { return Cache.get(method); }
  static unmount(...objects: any[]): Transaction { return Cache.unmount(...objects); }

  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Handle.setHint(obj, name); }
  static getTraceHint<T extends object>(obj: T): string | undefined { return Handle.getHint(obj); }
  static setTrace(t: Trace | undefined) { Dbg.global = t || Dbg.OFF; Dbg.isOn = t !== undefined; }
  static get trace(): Trace { return Dbg.trace; }
  static get isTraceOn(): boolean { return Dbg.isOn; }
}
