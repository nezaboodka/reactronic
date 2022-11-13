// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Transaction } from './impl/Transaction'
import { nonreactive } from './Rx'

export type BoolOnly<T> = Pick<T, {[P in keyof T]: T[P] extends boolean ? P : never}[keyof T]>
export type GivenTypeOnly<T, V> = Pick<T, {[P in keyof T]: T[P] extends V ? P : never}[keyof T]>

declare global {
  interface T extends Object {
    $$: { readonly [P in keyof T]-?: Ref<T[P]> }
  }
}

export function refs<O extends object = object>(owner: O): { readonly [P in keyof O]-?: Ref<O[P]> } {
  return new Proxy<O>(owner, RefGettingProxy) as any
}

export function toggleRefs<O extends object = object>(owner: O): { readonly [P in keyof BoolOnly<O>]: ToggleRef<O[P]> } {
  return new Proxy<O>(owner, BoolRefGettingProxy) as any
}

export function customToggleRefs<T, O extends object = any>(owner: O, value1: T, value2: T): { readonly [P in keyof GivenTypeOnly<O, T | any>]: ToggleRef<O[P]> } {
  const handler: any = new CustomToggleRefGettingProxy<T>(value1, value2)
  return new Proxy<O>(owner, handler) as any
}


export class Ref<T = any> {
  constructor(
    readonly owner: any,
    readonly name: string,
    readonly index: number = -1) {
  }

  get variable(): T {
    if (this.index < 0)
      return this.owner[this.name]
    else
      return this.owner[this.name][this.index]
  }

  set variable(value: T) {
    if (this.index < 0)
      this.owner[this.name] = value
    else
      this.owner[this.name][this.index] = value
  }

  unobservable(): T {
    return nonreactive(() => this.variable)
  }

  observe(): T {
    return this.variable
  }

  unobserve(): T {
    throw new Error('not implemented')
  }

  static sameRefs(v1: Ref, v2: Ref): boolean {
    return v1.owner === v2.owner && v1.name === v2.name && v1.index === v2.index
  }

  static similarRefs(v1: Ref, v2: Ref): boolean {
    return v1.owner.constructor === v2.owner.constructor && v1.name === v2.name && v1.index === v2.index
  }
}

export class ToggleRef<T = boolean> extends Ref<T> {
  constructor(
    owner: any,
    name: string,
    readonly valueOn: T,
    readonly valueOff: T) {
    super(owner, name)
  }

  toggle(): void {
    const o = this.owner
    const p = this.name
    Transaction.run({ hint: `toggle ${(o as any).constructor.name}.${p}` }, () => {
      const v = o[p]
      const isOn = v === this.valueOn || (
        v instanceof Ref && this.valueOn instanceof Ref &&
        Ref.sameRefs(v, this.valueOn))
      if (!isOn)
        o[p] = this.valueOn
      else
        o[p] = this.valueOff
    })
  }
}

// Internal

const RefGettingProxy: ProxyHandler<any> = {
  get: <T = any, O = any>(obj: O, prop: keyof {[P in keyof O]: O[P] extends T ? P : never}): Ref<T> => {
    return new Ref<T>(obj, prop as string)
  },
}

const BoolRefGettingProxy: ProxyHandler<any> = {
  get: <T, O = any>(obj: O, prop: keyof {[P in keyof O]: O[P] extends T ? P : never}): ToggleRef<T> => {
    return new ToggleRef<any>(obj, prop as string, true, false)
  },
}

class CustomToggleRefGettingProxy<T> {
  constructor(
    readonly value1: T,
    readonly value2: T) {
  }

  get<O = any>(obj: O, prop: keyof {[P in keyof O]: O[P] extends T ? P : never}): ToggleRef<T> {
    return new ToggleRef<T>(obj, prop as string, this.value1, this.value2)
  }
}

Object.defineProperty(Object.prototype, '$$', {
  configurable: false, enumerable: false,
  get(): { readonly [P in keyof T]-?: Ref<T[P]> } {
    return new Proxy<T>(this, RefGettingProxy) as any
  },
})
