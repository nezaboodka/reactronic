// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant, Sealed } from './Sealant'

declare global {
  interface Set<T> {
    mutable: Set<T>
    [Sealant.SealType]: object
  }
}

export abstract class SealedSet<T> extends Set<T> implements Sealed<Set<T>> {
  add(value: T): this { throw Sealant.error(this) }
  clear(): void { throw Sealant.error(this) }
  delete(value: T): boolean { throw Sealant.error(this) }
  [Sealant.OwnObject]: any
  [Sealant.OwnMember]: any
  [Sealant.Clone](): Set<T> { return new Set<T>(this.values()) }
}

Object.defineProperty(Set.prototype, 'mutable', {
  configurable: false, enumerable: false,
  get<T>(this: Set<T>) {
    return Sealant.mutable(this)
  },
})

Object.defineProperty(Set.prototype, Sealant.SealType, {
  value: SealedSet.prototype,
  configurable: false, enumerable: false, writable: false,
})
