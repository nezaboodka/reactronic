// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

const EMPTY_META = Object.freeze({})

export abstract class Meta {
  static readonly Holder: unique symbol = Symbol('rxHolder')
  static readonly Controller: unique symbol = Symbol('rxController')
  static readonly Disposed: unique symbol = Symbol('rxDisposed')
  static readonly Initial: unique symbol = Symbol('rxInitial')
  static readonly Reactions: unique symbol = Symbol('rxReactions')
  static readonly Nonsubscribing: unique symbol = Symbol('rxNonsubscribing')
  static readonly Undefined: unique symbol = Symbol('rxUndefined')

  static get<T>(obj: any, sym: symbol): T {
    return obj[sym]
  }

  static set(obj: any, sym: symbol, value: any): any {
    Object.defineProperty(obj, sym, { value, configurable: false, enumerable: false })
    return obj
  }

  static acquire(proto: any, sym: symbol): any {
    let meta: any = proto[sym]
    if (!proto.hasOwnProperty(sym)) {
      meta = { ...meta } // clone meta from parent class
      Meta.set(proto, sym, meta)
    }
    return meta
  }

  static getFrom<T = any>(proto: any, sym: symbol): T {
    return proto[sym] ?? /* istanbul ignore next */ EMPTY_META
  }
}
