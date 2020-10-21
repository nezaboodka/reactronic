// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealable, SealUtil } from './Sealable'

declare global {
  interface Map<K, V> {
    mutable: Map<K, V>
    [SealUtil.Owner]: any
    [SealUtil.Member]: any
    [SealUtil.Seal](owner: any, member: any): void
    [SealUtil.Clone](): Map<K, V>
  }
}

export abstract class SealedMap<K, V> extends Map<K, V> implements Sealable<Map<K, V>> {
  clear(): void { throw SealUtil.error(this) }
  delete(key: K): boolean { throw SealUtil.error(this) }
  set(key: K, value: V): this { throw SealUtil.error(this) }
}

Object.defineProperty(Map.prototype, 'mutable', {
  configurable: false, enumerable: false,
  get<K, V>(this: Map<K, V>) {
    return SealUtil.mutable(this)
  },
})

Object.defineProperty(Map.prototype, SealUtil.Seal, {
  configurable: false, enumerable: false, writable: false,
  value<K, V>(this: Map<K, V>, owner: any, member: any): void {
    SealUtil.seal(this, owner, member, SealedMap.prototype, this.size)
  },
})

Object.defineProperty(Map.prototype, SealUtil.Clone, {
  configurable: false, enumerable: false, writable: false,
  value<K, V>(this: Map<K, V>): Map<K, V> {
    return new Map<K, V>(this.entries())
  },
})

