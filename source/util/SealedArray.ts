// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealable, Sealant } from './Sealant'

declare global {
  interface Array<T> {
    mutable: Array<T>
    [Sealant.OwnObject]: any
    [Sealant.OwnMember]: any
    [Sealant.Seal](owner: any, member: any): void
    [Sealant.Unseal](): Array<T>
  }
}

export abstract class SealedArray<T> extends Array<T> implements Sealable<Array<T>> {
  pop(): T | undefined { throw Sealant.error(this) }
  push(...items: T[]): number { throw Sealant.error(this) }
  sort(compareFn?: (a: T, b: T) => number): this { throw Sealant.error(this) }
  splice(start: number, deleteCount?: number): T[]
  splice(start: number, deleteCount: number, ...items: T[]): T[] { throw Sealant.error(this) }
  unshift(...items: T[]): number { throw Sealant.error(this) }

  slice(start?: number, end?: number): T[] {
    const result = super.slice(start, end)
    Object.setPrototypeOf(result, Array.prototype)
    return result
  }

  [Sealant.Unseal](): Array<T> {
    return this.slice()
  }
}

Object.defineProperty(Array.prototype, 'mutable', {
  configurable: false, enumerable: false,
  get<T>(this: Array<T>) {
    return Sealant.mutable(this)
  },
})

Object.defineProperty(Array.prototype, Sealant.Seal, {
  configurable: false, enumerable: false, writable: false,
  value<T>(this: Array<T>, owner: any, member: any): void {
    Sealant.seal(this, owner, member, SealedArray.prototype, this.length)
  },
})
