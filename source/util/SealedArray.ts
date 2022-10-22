// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant, Sealed } from './Sealant'

declare global {
  interface Array<T> {
    toMutable(): Array<T>
    [Sealant.SealedType]: object
  }
}

export abstract class SealedArray<T> extends Array<T> implements Sealed<Array<T>> {
  pop(): T | undefined { throw Sealant.error(this) }
  push(...items: T[]): number { throw Sealant.error(this) }
  sort(compareFn?: (a: T, b: T) => number): this { throw Sealant.error(this) }
  splice(start: number, deleteCount?: number): T[]
  splice(start: number, deleteCount: number, ...items: T[]): T[] { throw Sealant.error(this) }
  unshift(...items: T[]): number { throw Sealant.error(this) }
  [Sealant.CreateCopy](): Array<T> { return this.slice() }

  slice(start?: number, end?: number): T[] {
    const result = super.slice(start, end)
    Object.setPrototypeOf(result, Array.prototype)
    return result
  }

}

Object.defineProperty(Array.prototype, 'toMutable', {
  configurable: false, enumerable: false,
  value<T>(this: Array<T>) {
    return Sealant.toMutable(this)
  },
})

Object.defineProperty(Array.prototype, Sealant.SealedType, {
  value: SealedArray.prototype,
  configurable: false, enumerable: false, writable: false,
})
