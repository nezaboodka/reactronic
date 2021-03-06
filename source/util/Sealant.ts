// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Dbg, misuse } from './Dbg'

export interface Sealable<T> {
  toMutable(): T
  [Sealant.SealedType]: object
}

export interface Sealed<T> {
  [Sealant.Clone]?: () => T
}

export abstract class Sealant {
  static readonly SealedType: unique symbol = Symbol('rxSealedType')
  static readonly Clone: unique symbol = Symbol('rxClone')

  static seal<T extends Sealable<T>>(collection: T, sealedType: object, typeName: string, member: any): T {
    let result: T & Sealed<T> = collection as any
    const clone = result[Sealant.Clone]
    if (clone)
      result = clone.call(result) as any
    if (Dbg.isOn && Dbg.trace.writes)
      Dbg.log('║', ' ', `${typeName}.${member.toString()} - collection is sealed`)
    Object.setPrototypeOf(result, sealedType)
    Object.freeze(result)
    return result
  }

  static toMutable<T extends Sealable<T>>(collection: T): T {
    const col: Sealed<T> = collection as any
    const clone = col[Sealant.Clone]
    if (clone)
      collection = clone.call(collection)
    return collection
  }

  static error(collection: Sealed<any>): Error {
    return misuse('use toMutable to modify sealed collection')
  }
}
