// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Dbg, misuse } from './Dbg'

export interface Sealable<T> {
  mutable: T
  [Sealant.SealType]: object
}

export interface Sealed<T> {
  [Sealant.OwnObject]: any
  [Sealant.OwnMember]: any
  [Sealant.Clone]?: () => T
}

export abstract class Sealant {
  static readonly OwnObject: unique symbol = Symbol('rxOwnObject')
  static readonly OwnMember: unique symbol = Symbol('rxOwnMember')
  static readonly SealType: unique symbol = Symbol('rxSealType')
  static readonly Clone: unique symbol = Symbol('rxClone')

  static seal<T extends Sealable<T>>(collection: T, owner: any, member: any, proto: object): T {
    if (Object.isFrozen(collection)) /* istanbul ignore next */
      throw misuse('sealable collection cannot be referenced from multiple objects')
    if (Dbg.isOn && Dbg.trace.writes)
      Dbg.log('║', ' ', `<obj>.${member.toString()} - collection is sealed`)
    const sealed: T & Sealed<T> = collection as any
    Object.defineProperty(sealed, Sealant.OwnObject, { value: owner, writable: false, enumerable: false, configurable: false })
    Object.defineProperty(sealed, Sealant.OwnMember, { value: member, writable: false, enumerable: false, configurable: false })
    Object.setPrototypeOf(sealed, proto)
    Object.freeze(sealed)
    return sealed
  }

  static mutable<T extends Sealable<T>>(collection: T): T {
    const col: Sealed<T> = collection as any
    const clone = col[Sealant.Clone]
    if (clone) {
      const owner = col[Sealant.OwnObject]
      const member = col[Sealant.OwnMember]
      const another = owner[member] // re-read collection from owner
      if (another === collection) { // not unsealed yet
        collection = clone.call(collection)
        owner[member] = collection // remember
      }
      else
        collection = another // re-use already unsealed collection
    }
    return collection
  }

  static error(collection: Sealed<any>): Error {
    const owner = collection[Sealant.OwnObject]
    const member = collection[Sealant.OwnMember]
    return new Error(`stateful collection ${owner}.${member} is always immutable`)
  }
}
