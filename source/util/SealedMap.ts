// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealable, Sealer } from './Sealer'

declare global {
  interface Map<K, V> {
    mutable: Map<K, V>
    [Sealer.OwnObject]: any
    [Sealer.OwnMember]: any
    [Sealer.Seal](owner: any, member: any): void
    [Sealer.Unseal](): Map<K, V>
  }
}

export abstract class SealedMap<K, V> extends Map<K, V> implements Sealable<Map<K, V>> {
  clear(): void { throw Sealer.error(this) }
  delete(key: K): boolean { throw Sealer.error(this) }
  set(key: K, value: V): this { throw Sealer.error(this) }
  [Sealer.Unseal](): Map<K, V> { return new Map<K, V>(this.entries()) }
}

Object.defineProperty(Map.prototype, 'mutable', {
  configurable: false, enumerable: false,
  get<K, V>(this: Map<K, V>) {
    return Sealer.mutable(this)
  },
})

Object.defineProperty(Map.prototype, Sealer.Seal, {
  configurable: false, enumerable: false, writable: false,
  value<K, V>(this: Map<K, V>, owner: any, member: any): void {
    Sealer.seal(this, owner, member, SealedMap.prototype, this.size)
  },
})
