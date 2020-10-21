// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from './Dbg'
import { Sealable, SealUtil } from './Sealable'

declare global {
  interface Array<T> {
    mutable: Array<T>
    [SealUtil.Owner]: any
    [SealUtil.Member]: any
    [SealUtil.Seal](owner: any, member: any): void
    [SealUtil.Clone](): Array<T>
  }
}

export abstract class SealedArray<T> extends Array<T> implements Sealable<Array<T>> {
  pop(): T | undefined { throw misuse(SealUtil.Error) }
  push(...items: T[]): number { throw misuse(SealUtil.Error) }
  sort(compareFn?: (a: T, b: T) => number): this { throw misuse(SealUtil.Error) }
  splice(start: number, deleteCount?: number): T[]
  splice(start: number, deleteCount: number, ...items: T[]): T[] { throw misuse(SealUtil.Error) }
  unshift(...items: T[]): number { throw misuse(SealUtil.Error) }
}

Object.defineProperty(Array.prototype, 'mutable', {
  configurable: false, enumerable: false,
  get<T>(this: Array<T>) {
    return SealUtil.mutable(this)
  },
})

Object.defineProperty(Array.prototype, SealUtil.Seal, {
  configurable: false, enumerable: false, writable: false,
  value<T>(this: Array<T>, owner: any, member: any): void {
    SealUtil.seal(this, owner, member, SealedArray.prototype, this.length)
  },
})

Object.defineProperty(Array.prototype, SealUtil.Clone, {
  configurable: false, enumerable: false, writable: false,
  value<T>(this: Array<T>): Array<T> {
    return this.slice()
  },
})
