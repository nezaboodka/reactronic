// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealable, Sealer } from './Sealer'

declare global {
  interface Set<T> {
    mutable: Set<T>
    [Sealer.OwnObject]: any
    [Sealer.OwnMember]: any
    [Sealer.Seal](owner: any, member: any): void
    [Sealer.Unseal](): Set<T>
  }
}

export abstract class SealedSet<T> extends Set<T> implements Sealable<Set<T>> {
  add(value: T): this { throw Sealer.error(this) }
  clear(): void { throw Sealer.error(this) }
  delete(value: T): boolean { throw Sealer.error(this) }
  [Sealer.Unseal](): Set<T> { return new Set<T>(this.values()) }
}

Object.defineProperty(Set.prototype, 'mutable', {
  configurable: false, enumerable: false,
  get<T>(this: Set<T>) {
    return Sealer.mutable(this)
  },
})

Object.defineProperty(Set.prototype, Sealer.Seal, {
  configurable: false, enumerable: false, writable: false,
  value<T>(this: Set<T>, owner: any, member: any): void {
    Sealer.seal(this, owner, member, SealedSet.prototype, this.size)
  },
})
