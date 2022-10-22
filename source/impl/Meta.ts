// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

const EMPTY_META = Object.freeze({})

export abstract class Meta {
  static readonly Handle: unique symbol = Symbol('rx-handle')
  static readonly Revision: unique symbol = Symbol('rx-revision')
  static readonly Controller: unique symbol = Symbol('rx-controller')
  static readonly Initial: unique symbol = Symbol('rx-initial')
  static readonly Reactive: unique symbol = Symbol('rx-reactive')
  static readonly Raw: unique symbol = Symbol('rx-raw')
  static readonly Undefined: unique symbol = Symbol('rx-undefined')

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
