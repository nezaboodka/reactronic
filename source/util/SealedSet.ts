// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealable, SealUtil } from './Sealable'

declare global {
  interface Set<T> {
    mutable: Set<T>
    [SealUtil.Owner]: any
    [SealUtil.Member]: any
    [SealUtil.Seal](owner: any, member: any): void
    [SealUtil.Unseal](): Set<T>
  }
}

export abstract class SealedSet<T> extends Set<T> implements Sealable<Set<T>> {
  add(value: T): this { throw SealUtil.error(this) }
  clear(): void { throw SealUtil.error(this) }
  delete(value: T): boolean { throw SealUtil.error(this) }
}

Object.defineProperty(Set.prototype, 'mutable', {
  configurable: false, enumerable: false,
  get<T>(this: Set<T>) {
    return SealUtil.mutable(this)
  },
})

Object.defineProperty(Set.prototype, SealUtil.Seal, {
  configurable: false, enumerable: false, writable: false,
  value<T>(this: Set<T>, owner: any, member: any): void {
    SealUtil.seal(this, owner, member, SealedSet.prototype, this.size)
  },
})

Object.defineProperty(Set.prototype, SealUtil.Unseal, {
  configurable: false, enumerable: false, writable: false,
  value<T>(this: Set<T>): Set<T> {
    return new Set<T>(this.values())
  },
})
