// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant } from '../util/Sealant'
import { TransactionalObject } from './Hooks'

// HookedArray

export class HookedArray<T> extends TransactionalObject {
  private all: Array<T>

  constructor(reactive: boolean, array: Array<T>) {
    super(reactive)
    this.all = array
  }

  get length(): number { return this.all.length }
  set length(n: number) { this.mutable.length = n }
  getItem(n: number): T { return this.all[n] }
  setItem(n: number, item: T): void { this.mutable[n] = item }
  toString(): string { return this.all.toString() }
  toLocaleString(): string { return this.all.toLocaleString() }
  pop(): T | undefined { return this.mutable.pop() }
  push(...items: T[]): number { return this.mutable.push(...items) }

  concat(...items: (T | ConcatArray<T>)[]): T[]
  concat(...items: ConcatArray<T>[]): T[]
  concat(...items: ConcatArray<T>[]): T[] { return this.all.concat(...items) }

  join(separator?: string): string { return this.all.join(separator) }
  reverse(): T[] { return this.mutable.reverse() }
  shift(): T | undefined { return this.mutable.shift() }
  slice(start?: number, end?: number): T[] { return this.all.slice(start, end) }
  sort(compareFn?: (a: T, b: T) => number): this { this.mutable.sort(compareFn); return this }

  splice(start: number, deleteCount?: number): T[]
  splice(start: number, deleteCount: number, ...items: T[]): T[]
  splice(start: number, deleteCount: number, ...items: T[]): T[] { return this.mutable.splice(start, deleteCount, ...items) }

  unshift(...items: T[]): number { return this.mutable.unshift(...items) }
  includes(searchElement: T, fromIndex?: number): boolean { return this.all.includes(searchElement, fromIndex) }
  indexOf(searchElement: T, fromIndex?: number): number { return this.all.indexOf(searchElement, fromIndex) }

  lastIndexOf(searchElement: T, fromIndex?: number): number { return this.all.lastIndexOf(searchElement, fromIndex) }

  every(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean
  every<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): this is S[]
  every(predicate: (value: T, index: number, array: T[]) => any, thisArg?: any): any { return this.all.every(predicate, thisArg) }

  some(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean { return this.all.some(predicate, thisArg) }
  forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void { return this.all.forEach(callbackfn, thisArg) }
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[] { return this.all.map(callbackfn, thisArg) }

  filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T[]
  filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[]
  filter(predicate: (value: T, index: number, array: T[]) => any, thisArg?: any): any[] { return this.all.filter(predicate, thisArg) }

  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U
  reduce(callbackfn: (previousValue: any, currentValue: T, currentIndex: number, array: T[]) => any, initialValue?: any): any { return initialValue !== undefined ? this.all.reduce(callbackfn, initialValue) : this.all.reduce(callbackfn) }

  reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
  reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T
  reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U
  reduceRight(callbackfn: (previousValue: any, currentValue: T, currentIndex: number, array: T[]) => any, initialValue?: any): any { return initialValue !== undefined ? this.all.reduceRight(callbackfn, initialValue) : this.all.reduceRight(callbackfn) }

  find<S extends T>(predicate: (this: void, value: T, index: number, obj: T[]) => value is S, thisArg?: any): S | undefined { return this.all.find(predicate, thisArg) }
  findIndex(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): number { return this.all.findIndex(predicate, thisArg) }
  fill(value: T, start?: number, end?: number): this { this.mutable.fill(value, start, end); return this }
  copyWithin(target: number, start: number, end?: number): this { this.mutable.copyWithin(target, start, end); return this }

  [Symbol.iterator](): IterableIterator<T> { return this.all[Symbol.iterator]() }
  entries(): IterableIterator<[number, T]> { return this.all.entries() }
  keys(): IterableIterator<number> { return this.all.keys() }
  values(): IterableIterator<T> { return this.all.values() }

  private get mutable(): Array<T> {
    const createCopy = (this.all as any)[Sealant.CreateCopy]
    if (createCopy)
      return this.all = createCopy.call(this.all)
    return this.all
  }
}

// TransactionalArray

export class TransactionalArray<T> extends HookedArray<T> {
  constructor()
  constructor(arrayLength: number)
  constructor(arrayLength?: number)
  constructor(...items: T[])
  constructor(args?: any) {
    super(false, args !== undefined ? new Array<T>(args) : new Array<T>())
  }
}

// ReactiveArray

export class ReactiveArray<T> extends HookedArray<T> {
  constructor()
  constructor(arrayLength: number)
  constructor(arrayLength?: number)
  constructor(...items: T[])
  constructor(args?: any) {
    super(true, args !== undefined ? new Array<T>(args) : new Array<T>())
  }
}
