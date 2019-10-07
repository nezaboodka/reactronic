// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Binding, R, W } from './Binding'
export { Binding } from './Binding'

export abstract class CopyOnWriteArray<T> extends Array<T> {
  get length(): number { return super.length /* S<T[]>(this);*/ }
  toString(): string { return super.toString.call(R<T[]>(this)) }
  toLocaleString(): string { return super.toLocaleString.call(R<T[]>(this)) }
  pop(): T | undefined { return super.pop.call(W<T[]>(this)) }
  push(...items: T[]): number { return super.push.call(W<T[]>(this), ...items) }
  concat(...items: Array<ConcatArray<T>>): T[]
  concat(...items: Array<T | ConcatArray<T>>): T[] { return super.concat.call(R<T[]>(this), ...items) }
  join(separator?: string): string { return super.join.call(R<T[]>(this), separator) }
  reverse(): T[] { return super.reverse.call(R<T[]>(this)) }
  shift(): T | undefined { return super.shift.call(R<T[]>(this)) }
  slice(start?: number, end?: number): T[] { return super.slice.call(R<T[]>(this), start, end) }
  sort(compareFn?: (a: T, b: T) => number): this { super.sort.call(W<T[]>(this), compareFn); return this }
  splice(start: number, deleteCount?: number): T[]
  splice(start: number, deleteCount: number, ...items: T[]): T[] { return super.splice.call(W<T[]>(this), start, deleteCount, ...items) }
  unshift(...items: T[]): number { return super.unshift.call(W<T[]>(this), ...items) }
  indexOf(searchElement: T, fromIndex?: number): number { return super.indexOf.call(R<T[]>(this), searchElement, fromIndex) }
  lastIndexOf(searchElement: T, fromIndex?: number): number { return super.lastIndexOf.call(R<T[]>(this), searchElement, fromIndex) }
  every(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean { return super.every.call(R<T[]>(this), callbackfn, thisArg) }
  some(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean { return super.some.call(R<T[]>(this), callbackfn, thisArg) }
  forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void { return super.forEach.call(R<T[]>(this), callbackfn, thisArg) }
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[] { return (super.map as any).call(R<T[]>(this), callbackfn, thisArg) }
  filter<S extends T>(callbackfn: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[]
  filter(callbackfn: (value: T, index: number, array: T[]) => any, thisArg?: any): T[] { return super.filter.call(R<T[]>(this), callbackfn, thisArg) }
  // reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue?: T): T
  // reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U { return super.reduce.call(R<T[]>(this), callbackfn, initialValue) }
  // reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue?: T): T
  // reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U { return super.reduceRight.call(R<T[]>(this), callbackfn, initialValue) }

  static seal<T>(owner: any, prop: PropertyKey, array: T[]): Binding<T[]> {
    return Binding.seal(owner, prop, array, array.length, CopyOnWriteArray.prototype, CopyOnWriteArray.getSize, CopyOnWriteArray.clone)
  }

  static getSize<T>(set: T[]): number {
    return set.length
  }

  static clone<T>(array: T[]): T[] {
    return Array.prototype.slice.call(array)
  }
}
