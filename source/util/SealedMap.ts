// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant, Sealed } from "./Sealant.js"

declare global {
  interface Map<K, V> {
    toMutable(): Map<K, V>
    [Sealant.SealedType]: object
  }
}

export abstract class SealedMap<K, V> extends Map<K, V> implements Sealed<Map<K, V>> {
  override clear(): void { throw Sealant.error(this) }
  override delete(key: K): boolean { throw Sealant.error(this) }
  override set(key: K, value: V): this { throw Sealant.error(this) }
  [Sealant.CreateCopy](): Map<K, V> { return new Map<K, V>(this.entries()) }
}

Object.defineProperty(Map.prototype, "toMutable", {
  configurable: false, enumerable: false,
  value<K, V>(this: Map<K, V>) {
    return Sealant.toMutable(this)
  },
})

Object.defineProperty(Map.prototype, Sealant.SealedType, {
  value: SealedMap.prototype,
  configurable: false, enumerable: false, writable: false,
})
