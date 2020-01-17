// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { CopyOnWrite, R, W } from './CopyOnWrite'
export { CopyOnWrite } from './CopyOnWrite'

export abstract class CopyOnWriteSet<T> extends Set<T> {
  add(value: T): this { super.add.call(W<Set<T>>(this), value); return this }
  clear(): void { return super.clear.call(W<Set<T>>(this)) }
  delete(value: T): boolean { return super.delete.call(W<Set<T>>(this), value) }
  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void { super.forEach.call(R<Set<T>>(this), callbackfn, thisArg) }
  has(value: T): boolean { return super.has.call(R<Set<T>>(this), value) }
  get size(): number { return super.size /* S<Set<T>>(this)*/ }
  entries(): IterableIterator<[T, T]> { return super.entries.call(R<Set<T>>(this)) }
  keys(): IterableIterator<T> { return super.keys.call(R<Set<T>>(this)) }
  values(): IterableIterator<T> { return super.values.call(R<Set<T>>(this)) }

  static seal<T>(owner: any, prop: PropertyKey, set: Set<T>): CopyOnWrite<Set<T>> {
    return CopyOnWrite.seal(owner, prop, set, set.size, CopyOnWriteSet.prototype, CopyOnWriteSet.getSize, CopyOnWriteSet.clone)
  }

  static getSize<T>(set: Set<T>): number {
    return set.size
  }

  static clone<T>(set: Set<T>): Set<T> {
    return new Set<T>(Set.prototype.values.call(set))
  }
}
