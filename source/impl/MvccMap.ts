// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant } from '../util/Sealant'
import { TransactionalObject } from './Mvcc'

// MvccMap

export class MvccMap<K, V> extends TransactionalObject {
  private all: Map<K, V>

  constructor(reactive: boolean, map: Map<K, V>) {
    super(reactive)
    this.all = map
  }

  clear(): void { this.mutable.clear() }
  delete(key: K): boolean { return this.mutable.delete(key) }
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void { this.all.forEach(callbackfn, thisArg) }
  get(key: K): V | undefined { return this.all.get(key) }
  has(key: K): boolean { return this.all.has(key) }
  set(key: K, value: V): this { this.mutable.set(key, value); return this }
  get size(): number { return this.all.size }

  entries(): IterableIterator<[K, V]> { return this.all.entries() }
  keys(): IterableIterator<K> { return this.all.keys() }
  values(): IterableIterator<V> { return this.all.values() }

  [Symbol.toStringTag](): string { return this.all[Symbol.toStringTag] }

  private get mutable(): Map<K, V> {
    const createCopy = (this.all as any)[Sealant.CreateCopy]
    if (createCopy)
      return this.all = createCopy.call(this.all)
    return this.all
  }
}

// TransactionalMap<K, V>

export class TransactionalMap<K, V> extends MvccMap<K, V> {
  constructor()
  constructor(iterable?: Iterable<readonly [K, V]> | null)
  constructor(args?: any) {
    super(true, args !== undefined ? new Map<K, V>(args) : new Map<K, V>())
  }
}

// ReactiveMap<K, V>

export class ReactiveMap<K, V> extends MvccMap<K, V> {
  constructor()
  constructor(iterable?: Iterable<readonly [K, V]> | null)
  constructor(args?: any) {
    super(true, args !== undefined ? new Map<K, V>(args) : new Map<K, V>())
  }
}
