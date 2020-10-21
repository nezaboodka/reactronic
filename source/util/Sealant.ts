// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Dbg, misuse } from './Dbg'

export interface Sealable<T> {
  mutable: T
  [Sealant.OwnObject]: any
  [Sealant.OwnMember]: any
  [Sealant.Seal](owner: any, member: any): void
  [Sealant.Unseal](): T
}

export abstract class Sealant {
  static readonly OwnObject: unique symbol = Symbol('rxOwnObject')
  static readonly OwnMember: unique symbol = Symbol('rxOwnMember')
  static readonly Seal: unique symbol = Symbol('rxSeal')
  static readonly Unseal: unique symbol = Symbol('rxUnseal')

  static seal<T extends Sealable<T>>(sealable: T, owner: any, member: any, proto: object, size: number): T {
    if (Object.isFrozen(sealable)) /* istanbul ignore next */
      throw misuse('sealable collection cannot be referenced from multiple objects')
    if (Dbg.isOn && Dbg.trace.writes)
      Dbg.log('║', ' ', `<obj>.${member.toString()} - sealed ${size} item(s)`)
    const sealed: T & Sealable<T> = sealable as any
    Object.defineProperty(sealed, Sealant.OwnObject, { value: owner, writable: false, enumerable: false, configurable: false })
    Object.defineProperty(sealed, Sealant.OwnMember, { value: member, writable: false, enumerable: false, configurable: false })
    Object.setPrototypeOf(sealed, proto)
    Object.freeze(sealed)
    return sealed
  }

  static mutable<T extends Sealable<T>>(collection: T): T {
    let sealable = collection
    let owner = sealable[Sealant.OwnObject]
    if (owner) {
      sealable = owner[sealable[Sealant.OwnMember]] // re-read to grab existing mutable
      owner = sealable[Sealant.OwnObject]
      if (owner) { // not unsealed yet
        collection = sealable[Sealant.Unseal]() // unseal
        owner[sealable[Sealant.OwnMember]] = collection // remember
      }
    }
    return collection
  }

  static error(collection: Sealable<any>): Error {
    const owner = collection[Sealant.OwnObject]
    const member = collection[Sealant.OwnMember]
    return new Error(`stateful collection ${owner}.${member} is always immutable`)
  }
}
