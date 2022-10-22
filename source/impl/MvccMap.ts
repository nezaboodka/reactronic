// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant } from '../util/Sealant'
import { MvccObject } from './Mvcc'

// MvccMap

export class MvccMap<K, V> extends MvccObject {
  private impl: Map<K, V>

  constructor(isObservable: boolean, map: Map<K, V>) {
    super(isObservable)
    this.impl = map
  }

  clear(): void { this.mutable.clear() }
  delete(key: K): boolean { return this.mutable.delete(key) }
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void { this.impl.forEach(callbackfn, thisArg) }
  get(key: K): V | undefined { return this.impl.get(key) }
  has(key: K): boolean { return this.impl.has(key) }
  set(key: K, value: V): this { this.mutable.set(key, value); return this }
  get size(): number { return this.impl.size }

  entries(): IterableIterator<[K, V]> { return this.impl.entries() }
  keys(): IterableIterator<K> { return this.impl.keys() }
  values(): IterableIterator<V> { return this.impl.values() }

  [Symbol.toStringTag](): string { return this.impl[Symbol.toStringTag] }

  private get mutable(): Map<K, V> {
    const createCopy = (this.impl as any)[Sealant.CreateCopy]
    if (createCopy)
      return this.impl = createCopy.call(this.impl)
    return this.impl
  }
}

// TransactionalMap<K, V>

export class TransactionalMap<K, V> extends MvccMap<K, V> {
  constructor()
  constructor(iterable?: Iterable<readonly [K, V]> | null)
  constructor(args?: any) {
    super(false, args !== undefined ? new Map<K, V>(args) : new Map<K, V>())
  }
}

// ObservableMap<K, V>

export class ObservableMap<K, V> extends MvccMap<K, V> {
  constructor()
  constructor(iterable?: Iterable<readonly [K, V]> | null)
  constructor(args?: any) {
    super(true, args !== undefined ? new Map<K, V>(args) : new Map<K, V>())
  }
}
