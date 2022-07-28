// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant } from '../util/Sealant'
import { ReactiveObject } from './Hooks'

// ReactiveMap

export class ReactiveMap<K, V> extends ReactiveObject {
  private m: Map<K, V>

  constructor()
  constructor(iterable?: Iterable<readonly [K, V]> | null)
  constructor(args?: any) {
    super()
    this.m = new Map<K, V>(args)
  }

  clear(): void { this.mutable.clear() }
  delete(key: K): boolean { return this.mutable.delete(key) }
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void { this.m.forEach(callbackfn, thisArg) }
  get(key: K): V | undefined { return this.m.get(key) }
  has(key: K): boolean { return this.m.has(key) }
  set(key: K, value: V): this { this.mutable.set(key, value); return this }
  get size(): number { return this.m.size }

  entries(): IterableIterator<[K, V]> { return this.m.entries() }
  keys(): IterableIterator<K> { return this.m.keys() }
  values(): IterableIterator<V> { return this.m.values() }

  [Symbol.toStringTag](): string { return this.m[Symbol.toStringTag] }

  private get mutable(): Map<K, V> {
    const createCopy = (this.m as any)[Sealant.CreateCopy]
    if (createCopy)
      return this.m = createCopy.call(this.m)
    return this.m
  }
}
