// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealable, Sealant } from './Sealant'

declare global {
  interface Map<K, V> {
    mutable: Map<K, V>
    [Sealant.OwnObject]: any
    [Sealant.OwnMember]: any
    [Sealant.Seal](owner: any, member: any): void
    [Sealant.Unseal](): Map<K, V>
  }
}

export abstract class SealedMap<K, V> extends Map<K, V> implements Sealable<Map<K, V>> {
  clear(): void { throw Sealant.error(this) }
  delete(key: K): boolean { throw Sealant.error(this) }
  set(key: K, value: V): this { throw Sealant.error(this) }
  [Sealant.Unseal](): Map<K, V> { return new Map<K, V>(this.entries()) }
}

Object.defineProperty(Map.prototype, 'mutable', {
  configurable: false, enumerable: false,
  get<K, V>(this: Map<K, V>) {
    return Sealant.mutable(this)
  },
})

Object.defineProperty(Map.prototype, Sealant.Seal, {
  configurable: false, enumerable: false, writable: false,
  value<K, V>(this: Map<K, V>, owner: any, member: any): void {
    Sealant.seal(this, owner, member, SealedMap.prototype, this.size)
  },
})
