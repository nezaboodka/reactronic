// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant, Sealed } from "./Sealant.js"

declare global {
  interface Array<T> {
    toMutable(): Array<T>
    [Sealant.SealedType]: object
  }
}

export abstract class SealedArray<T> extends Array<T> implements Sealed<Array<T>> {
  override pop(): T | undefined { throw Sealant.error(this) }
  override push(...items: T[]): number { throw Sealant.error(this) }
  override sort(compareFn?: (a: T, b: T) => number): this { throw Sealant.error(this) }
  override splice(start: number, deleteCount?: number): T[]
  override splice(start: number, deleteCount: number, ...items: T[]): T[] { throw Sealant.error(this) }
  override unshift(...items: T[]): number { throw Sealant.error(this) }
  [Sealant.CreateCopy](): Array<T> { return this.slice() }

  override slice(start?: number, end?: number): T[] {
    const result = super.slice(start, end)
    Object.setPrototypeOf(result, Array.prototype)
    return result
  }
}

Object.defineProperty(Array.prototype, "toMutable", {
  configurable: false, enumerable: false,
  value<T>(this: Array<T>) {
    return Sealant.toMutable(this)
  },
})

Object.defineProperty(Array.prototype, Sealant.SealedType, {
  value: SealedArray.prototype,
  configurable: false, enumerable: false, writable: false,
})
