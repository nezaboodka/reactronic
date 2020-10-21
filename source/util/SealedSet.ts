// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealable, Sealant } from './Sealant'

declare global {
  interface Set<T> {
    mutable: Set<T>
    [Sealant.OwnObject]: any
    [Sealant.OwnMember]: any
    [Sealant.Seal](owner: any, member: any): void
    [Sealant.Unseal](): Set<T>
  }
}

export abstract class SealedSet<T> extends Set<T> implements Sealable<Set<T>> {
  add(value: T): this { throw Sealant.error(this) }
  clear(): void { throw Sealant.error(this) }
  delete(value: T): boolean { throw Sealant.error(this) }
  [Sealant.Unseal](): Set<T> { return new Set<T>(this.values()) }
}

Object.defineProperty(Set.prototype, 'mutable', {
  configurable: false, enumerable: false,
  get<T>(this: Set<T>) {
    return Sealant.mutable(this)
  },
})

Object.defineProperty(Set.prototype, Sealant.Seal, {
  configurable: false, enumerable: false, writable: false,
  value<T>(this: Set<T>, owner: any, member: any): void {
    Sealant.seal(this, owner, member, SealedSet.prototype, this.size)
  },
})
