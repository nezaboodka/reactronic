// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Dbg, misuse } from './Dbg'

export interface Sealable<T> {
  mutable: T
  [SealUtil.Owner]: any
  [SealUtil.Member]: any
  [SealUtil.Seal](owner: any, member: any): void
  [SealUtil.Clone](): T
}

export abstract class SealUtil {
  static readonly Owner: unique symbol = Symbol('rxOwner')
  static readonly Member: unique symbol = Symbol('rxMember')
  static readonly Seal: unique symbol = Symbol('rxSeal')
  static readonly Clone: unique symbol = Symbol('rxClone')
  static readonly Error = 'stateful collection field is always immutable'

  static seal<T extends Sealable<T>>(sealable: T, owner: any, member: any, proto: object, size: number): T {
    if (Object.isFrozen(sealable)) /* istanbul ignore next */
      throw misuse('sealable collection cannot be referenced from multiple objects')
    if (Dbg.isOn && Dbg.trace.writes)
      Dbg.log('║', ' ', `<obj>.${member.toString()} - sealed ${size} item(s)`)
    const sealed: T & Sealable<T> = sealable as any
    Object.defineProperty(sealed, SealUtil.Owner, { value: owner, writable: false, enumerable: false, configurable: false })
    Object.defineProperty(sealed, SealUtil.Member, { value: member, writable: false, enumerable: false, configurable: false })
    Object.setPrototypeOf(sealed, proto)
    Object.freeze(sealed)
    return sealed
  }

  static mutable<T>(collection: T): T {
    let sealable: Sealable<T> = collection as any
    let owner = sealable[SealUtil.Owner]
    if (owner) {
      sealable = owner[sealable[SealUtil.Member]] // re-read to grab existing mutable
      owner = sealable[SealUtil.Owner]
      if (owner) { // not yet cloned
        collection = sealable[SealUtil.Clone]() // clone
        owner[sealable[SealUtil.Member]] = collection // remember
      }
    }
    return collection
  }

}
