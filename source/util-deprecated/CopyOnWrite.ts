// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Dbg, misuse } from '../util/Dbg'

export const R_COPY_ON_WRITE: unique symbol = Symbol('R:COPY-ON-WRITE')

export class CopyOnWrite<T> {
  constructor(
    readonly owner: any,
    readonly member: PropertyKey,
    readonly payload: T,
    readonly size: number,
    readonly getSize: (value: T) => number,
    readonly clone: (value: T) => T) {
  }

  // sizing(receiver: any): number {
  //   const v: T = this.owner[this.prop]
  //   return v === receiver ? this.size : this.getSize(v)
  // }

  readable(receiver: any, raw?: boolean): T {
    let v: T = this.owner[this.member]
    if (v === receiver || raw) // check if array is not yet cloned
      v = this.payload
    return v
  }

  writable(receiver: any): T {
    let v: T = this.owner[this.member]
    if (v === receiver) { // check if it's first write and clone then
      if (Dbg.isOn && Dbg.trace.writes)
        Dbg.log('║', ' ', `<obj>.${this.member.toString()} - copy-on-write - cloned`)
      v = this.owner[this.member] = this.clone(this.payload)
    }
    return v
  }

  static seal<T>(owner: any, member: PropertyKey, payload: T, size: number, proto: object, getSize: (v: T) => number, clone: (v: T) => T): CopyOnWrite<T> {
    if (Object.isFrozen(payload)) /* istanbul ignore next */
      throw misuse('copy-on-write collection cannot be referenced from multiple objects')
    const self: any = payload
    if (Dbg.isOn && Dbg.trace.writes)
      Dbg.log('║', ' ', `<obj>.${member.toString()} - copy-on-write - sealed ${size} item(s)`)
    const handler = new CopyOnWrite<T>(owner, member, payload, size, getSize, clone)
    self[R_COPY_ON_WRITE] = handler
    Object.setPrototypeOf(payload, proto)
    Object.freeze(payload)
    return handler
  }
}

export function R<T>(self: any, raw?: boolean): T {
  const handler: CopyOnWrite<T> = self[R_COPY_ON_WRITE]
  return handler !== undefined ? handler.readable(self, raw) : self
}

export function W<T>(self: any): T {
  const handler: CopyOnWrite<T> = self[R_COPY_ON_WRITE]
  return handler !== undefined ? handler.writable(self) : self
}

// export function V<T>(self: any): T {
//   const binding: CopyOnWrite<T> = self[R_COPY_ON_WRITE]
//   return binding !== undefined ? binding.value : self
// }

// export function S<T>(self: any): number {
//   const binding: CopyOnWrite<T> = self[R_COPY_ON_WRITE]
//   return binding !== undefined ? binding.sizing(self) : -1
// }
