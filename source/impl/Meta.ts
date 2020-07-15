// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

const EMPTY_META = Object.freeze({})

export abstract class Meta {
  static readonly Handle: unique symbol = Symbol('rxHandle')
  static readonly Method: unique symbol = Symbol('rxMethod')
  static readonly Unmount: unique symbol = Symbol('rxUnmount')
  static readonly Blank: unique symbol = Symbol('rxBlank')
  static readonly Triggers: unique symbol = Symbol('rxTriggers')
  static readonly Stateless: unique symbol = Symbol('rxStateless')

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
      meta = {...meta} // clone meta from parent class
      Meta.set(proto, sym, meta)
    }
    return meta
  }

  static from<T>(proto: any, sym: symbol): T {
    return proto[sym] ?? /* istanbul ignore next */ EMPTY_META
  }
}
