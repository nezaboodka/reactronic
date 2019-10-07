// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Transaction } from './Transaction'
import { Options } from './Options'
import { CacheImpl, F } from '../core/all'

export function cacheof<T>(method: F<T>): Cache<T> {
  return Cache.of<T>(method)
}

export function resolved<T>(method: F<Promise<T>>, args?: any[]): T | undefined {
  return (cacheof(method) as any).call(args)
}

export function nonreactive<T>(func: F<T>, ...args: any[]): T {
  return CacheImpl.runAs<T>(undefined, func, ...args)
}

export function standalone<T>(func: F<T>, ...args: any[]): T {
  return CacheImpl.runAs<T>(undefined, Transaction.outside, func, ...args)
}

export abstract class Cache<T> {
  abstract setOptions(options: Partial<Options>): Options
  abstract readonly options: Options
  abstract readonly args: ReadonlyArray<any>
  abstract readonly value: T
  abstract readonly error: any
  abstract readonly stamp: number
  abstract readonly isInvalid: boolean
  abstract invalidate(): void
  abstract call(args?: any[]): T | undefined

  static of<T>(method: F<T>): Cache<T> { return CacheImpl.of(method) }
  static unmount(...objects: any[]): Transaction { return CacheImpl.unmount(...objects) }
}
