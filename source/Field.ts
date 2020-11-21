// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Transaction } from './impl/Transaction'

export type BoolOnly<T> = Pick<T, {[P in keyof T]: T[P] extends boolean ? P : never}[keyof T]>
export type GivenTypeOnly<T, V> = Pick<T, {[P in keyof T]: T[P] extends V ? P : never}[keyof T]>

export class Field<T = any> {
  constructor(
    readonly owner: any,
    readonly name: string,
    readonly index: number = -1) {
  }

  get value(): T {
    if (this.index < 0)
      return this.owner[this.name]
    else
      return this.owner[this.name][this.index]
  }

  set value(value: T) {
    if (this.index < 0)
      this.owner[this.name] = value
    else
      this.owner[this.name][this.index] = value
  }

  static of<O = any>(owner: O): { readonly [P in keyof O]-?: Field<O[P]> } {
    return new Proxy<{ readonly [P in keyof O]-?: Field<O[P]> }>(owner as any, FieldGettingProxy)
  }

  static toggleOf<O = any>(owner: O): { readonly [P in keyof BoolOnly<O>]: FieldToggle<O[P]> } {
    return new Proxy<{ readonly [P in keyof BoolOnly<O>]: FieldToggle<O[P]> }>(owner, BoolFieldGettingProxy)
  }

  static customToggleOf<T, O extends object = any>(owner: O, value1: T, value2: T): { readonly [P in keyof GivenTypeOnly<O, T | any>]: FieldToggle<O[P]> } {
    const handler = new FieldToggleGettingProxy<T>(value1, value2)
    return new Proxy<O>(owner, handler)
  }

  static sameFields(v1: Field, v2: Field): boolean {
    return v1.owner === v2.owner && v1.name === v2.name && v1.index === v2.index
  }

  static similarFields(v1: Field, v2: Field): boolean {
    return v1.owner.constructor === v2.owner.constructor && v1.name === v2.name && v1.index === v2.index
  }
}

export class FieldToggle<T = boolean> extends Field<T> {
  constructor(
    owner: any,
    name: string,
    readonly value1: T,
    readonly value2: T) {
    super(owner, name)
  }

  toggle(): void {
    const o = this.owner
    const p = this.name
    Transaction.runAs({ hint: `toggle ${(o as any).constructor.name}.${p}` }, () => {
      const v = o[p]
      const isValue1 = v === this.value1 || (
        v instanceof Field && this.value1 instanceof Field &&
        Field.sameFields(v, this.value1))
      if (!isValue1)
        o[p] = this.value1
      else
        o[p] = this.value2
    })
  }
}

// Internal

const FieldGettingProxy = {
  get: <T = any, O = any>(obj: O, prop: keyof {[P in keyof O]: O[P] extends T ? P : never}): Field<T> => {
    return new Field<T>(obj, prop as string)
  },
}

const BoolFieldGettingProxy = {
  get: <T, O = any>(obj: O, prop: keyof {[P in keyof O]: O[P] extends T ? P : never}): FieldToggle<T> => {
    return new FieldToggle<any>(obj, prop as string, true, false)
  },
}

class FieldToggleGettingProxy<T> {
  constructor(
    readonly value1: T,
    readonly value2: T) {
  }

  get<O = any>(obj: O, prop: keyof {[P in keyof O]: O[P] extends T ? P : never}): FieldToggle<T> {
    return new FieldToggle<T>(obj, prop as string, this.value1, this.value2)
  }
}
