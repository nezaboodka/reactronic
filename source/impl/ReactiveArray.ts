// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant } from '../util/Sealant'
import { ReactiveObject } from './Hooks'

// ReactiveArray

export class ReactiveArray<T> extends ReactiveObject {
  private a = new Array<T>()
  get length(): number { return this.a.length }
  set length(n: number) { this.mutable.length = n }
  get(n: number): T { return this.a[n] }
  set(n: number, item: T): void { this.mutable[n] = item }
  toString(): string { return this.a.toString() }
  toLocaleString(): string { return this.a.toLocaleString() }
  pop(): T | undefined { return this.mutable.pop() }
  push(...items: T[]): number { return this.mutable.push(...items) }

  concat(...items: (T | ConcatArray<T>)[]): T[]
  concat(...items: ConcatArray<T>[]): T[]
  concat(...items: ConcatArray<T>[]): T[] { return this.a.concat(...items) }

  join(separator?: string): string { return this.a.join(separator) }
  reverse(): T[] { return this.mutable.reverse() }
  shift(): T | undefined { return this.mutable.shift() }
  slice(start?: number, end?: number): T[] { return this.a.slice(start, end) }
  sort(compareFn?: (a: T, b: T) => number): this { this.mutable.sort(compareFn); return this }

  splice(start: number, deleteCount?: number): T[]
  splice(start: number, deleteCount: number, ...items: T[]): T[]
  splice(start: number, deleteCount: number, ...items: T[]): T[] { return this.mutable.splice(start, deleteCount, ...items) }

  unshift(...items: T[]): number { return this.mutable.unshift(...items) }
  indexOf(searchElement: T, fromIndex?: number): number { return this.a.indexOf(searchElement, fromIndex) }
  lastIndexOf(searchElement: T, fromIndex?: number): number { return this.a.lastIndexOf(searchElement, fromIndex) }

  every(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean
  every<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): this is S[]
  every(predicate: (value: T, index: number, array: T[]) => any, thisArg?: any): any { return this.a.every(predicate, thisArg) }

  some(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean { return this.a.some(predicate, thisArg) }
  forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void { return this.a.forEach(callbackfn, thisArg) }
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[] { return this.a.map(callbackfn, thisArg) }

  filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T[]
  filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[]
  filter(predicate: (value: T, index: number, array: T[]) => any, thisArg?: any): any[] { return this.a.filter(predicate, thisArg) }

  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U
  reduce(callbackfn: (previousValue: any, currentValue: T, currentIndex: number, array: T[]) => any, initialValue?: any): any { return initialValue !== undefined ? this.a.reduce(callbackfn, initialValue) : this.a.reduce(callbackfn) }

  reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
  reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T
  reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U
  reduceRight(callbackfn: (previousValue: any, currentValue: T, currentIndex: number, array: T[]) => any, initialValue?: any): any { return initialValue !== undefined ? this.a.reduceRight(callbackfn, initialValue) : this.a.reduceRight(callbackfn) }

  find<S extends T>(predicate: (this: void, value: T, index: number, obj: T[]) => value is S, thisArg?: any): S | undefined { return this.a.find(predicate, thisArg) }
  findIndex(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): number { return this.a.findIndex(predicate, thisArg) }
  fill(value: T, start?: number, end?: number): this { this.mutable.fill(value, start, end); return this }
  copyWithin(target: number, start: number, end?: number): this { this.mutable.copyWithin(target, start, end); return this }

  entries(): IterableIterator<[number, T]> { return this.a.entries() }
  keys(): IterableIterator<number> { return this.a.keys() }
  values(): IterableIterator<T> { return this.a.values() }

  private get mutable(): Array<T> {
    const createCopy = (this.a as any)[Sealant.CreateCopy]
    if (createCopy)
      return this.a = createCopy.call(this.a)
    return this.a
  }
}
