// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Log, misuse } from './Dbg'

export interface Sealable<T> {
  toMutable(): T
  [Sealant.SealedType]: object
}

export interface Sealed<T> {
  [Sealant.CreateCopy]?: () => T
}

export abstract class Sealant {
  static readonly SealedType: unique symbol = Symbol('rxSealedType')
  static readonly CreateCopy: unique symbol = Symbol('rxCreateCopy')

  static seal<T extends Sealable<T>>(collection: T, sealedType: object, typeName: string, member: any): T {
    let result: T & Sealed<T> = collection as any
    const createCopy = result[Sealant.CreateCopy]
    if (createCopy)
      result = createCopy.call(result) as any
    if (Log.isOn && Log.opt.write)
      Log.write('║', ' ', `${typeName}.${member.toString()} - collection is sealed`)
    Object.setPrototypeOf(result, sealedType)
    Object.freeze(result)
    return result
  }

  static toMutable<T extends Sealable<T>>(collection: T): T {
    const a: Sealed<T> = collection as any
    const createCopy = a[Sealant.CreateCopy]
    if (createCopy)
      collection = createCopy.call(collection)
    return collection
  }

  static error(collection: Sealed<any>): Error {
    return misuse('use toMutable to create mutable copy of sealed collection')
  }
}
