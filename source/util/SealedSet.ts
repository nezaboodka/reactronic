// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Sealant, Sealed } from "./Sealant.js"

declare global {
  interface Set<T> {
    toMutable(): Set<T>
    [Sealant.SealedType]: object
  }
}

export abstract class SealedSet<T> extends Set<T> implements Sealed<Set<T>> {
  override add(value: T): this { throw Sealant.error(this) }
  override clear(): void { throw Sealant.error(this) }
  override delete(value: T): boolean { throw Sealant.error(this) }
  [Sealant.CreateCopy](): Set<T> { return new Set<T>(this.values()) }
}

Object.defineProperty(Set.prototype, "toMutable", {
  configurable: false, enumerable: false,
  value<T>(this: Set<T>) {
    return Sealant.toMutable(this)
  },
})

Object.defineProperty(Set.prototype, Sealant.SealedType, {
  value: SealedSet.prototype,
  configurable: false, enumerable: false, writable: false,
})
