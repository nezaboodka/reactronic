// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Dbg, misuse } from './Dbg'

export interface Sealable<T> {
  createOrGetMutableCopy(): T
  [Sealant.SealType]: object
}

export interface Sealed<T> {
  [Sealant.Clone]?: () => T
}

export abstract class Sealant {
  static readonly SealType: unique symbol = Symbol('rxSealType')
  static readonly Clone: unique symbol = Symbol('rxClone')

  static seal<T extends Sealable<T>>(collection: T, owner: any, member: any, proto: object): T {
    let result: T & Sealed<T> = collection as any
    const clone = result[Sealant.Clone]
    if (clone)
      result = clone.call(result) as any
    if (Dbg.isOn && Dbg.trace.writes)
      Dbg.log('║', ' ', `${owner.constructor.name}.${member.toString()} - collection is sealed`)
    Object.setPrototypeOf(result, proto)
    Object.freeze(result)
    return result
  }

  static createOrGetMutableCopy<T extends Sealable<T>>(collection: T): T {
    const col: Sealed<T> = collection as any
    const clone = col[Sealant.Clone]
    if (clone)
      collection = clone.call(collection)
    return collection
  }

  static error(collection: Sealed<any>): Error {
    return misuse('use createOrGetMutableCopy to modify sealed collection')
  }
}
