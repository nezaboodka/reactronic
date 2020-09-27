// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Dbg, misuse } from './Dbg'

export const R_COPY_ON_WRITE: unique symbol = Symbol('R:COPY-ON-WRITE')

export class CopyOnWrite<T> {
  constructor(
    readonly owner: any,
    readonly prop: PropertyKey,
    readonly value: T,
    readonly size: number,
    readonly getSize: (value: T) => number,
    readonly clone: (value: T) => T) {
  }

  // sizing(receiver: any): number {
  //   const v: T = this.owner[this.prop]
  //   return v === receiver ? this.size : this.getSize(v)
  // }

  readable(receiver: any): T {
    let v: T = this.owner[this.prop]
    if (v === receiver) // check if array is not yet cloned
      v = this.value
    return v
  }

  writable(receiver: any): T {
    let v: T = this.owner[this.prop]
    if (v === receiver) { // check if it's first write and clone then
      if (Dbg.isOn && Dbg.logging.writes)
        Dbg.log('║', ' ', `<obj>.${this.prop.toString()} - copy-on-write - cloned`)
      v = this.owner[this.prop] = this.clone(this.value)
    }
    return v
  }

  static seal<T>(owner: any, prop: PropertyKey, value: T, size: number, proto: object, getSize: (v: T) => number, clone: (v: T) => T): CopyOnWrite<T> {
    if (Object.isFrozen(value)) /* istanbul ignore next */
      throw misuse('copy-on-write collection cannot be referenced from multiple objects')
    const self: any = value
    if (Dbg.isOn && Dbg.logging.writes)
      Dbg.log('║', ' ', `<obj>.${prop.toString()} - copy-on-write - sealed ${size} item(s)`)
    const binding = new CopyOnWrite<T>(owner, prop, value, size, getSize, clone)
    self[R_COPY_ON_WRITE] = binding
    Object.setPrototypeOf(value, proto)
    Object.freeze(value)
    return binding
  }
}

export function R<T>(self: any): T {
  const binding: CopyOnWrite<T> = self[R_COPY_ON_WRITE]
  return binding !== undefined ? binding.readable(self) : self
}

export function W<T>(self: any): T {
  const binding: CopyOnWrite<T> = self[R_COPY_ON_WRITE]
  return binding !== undefined ? binding.writable(self) : self
}

export function V<T>(self: any): T {
  const binding: CopyOnWrite<T> = self[R_COPY_ON_WRITE]
  return binding !== undefined ? binding.value : self
}

// export function S<T>(self: any): number {
//   const binding: CopyOnWrite<T> = self[R_COPY_ON_WRITE]
//   return binding !== undefined ? binding.sizing(self) : -1
// }
