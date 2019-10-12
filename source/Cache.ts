// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F } from './util/Utils'
import { Options } from './Options'
import { Action } from './Action'
import { Method } from './impl/Method' // implementation

export abstract class Cache<T> {
  abstract readonly options: Options
  abstract readonly args: ReadonlyArray<any>
  abstract readonly value: T
  abstract readonly error: any
  abstract readonly stamp: number
  abstract readonly invalid: boolean

  abstract setup(options: Partial<Options>): Options
  abstract invalidate(): void
  abstract pullValue(args?: any[]): T | undefined

  static of<T>(method: F<T>): Cache<T> { return Method.of(method) }
  static unmount(...objects: any[]): Action { return Method.unmount(...objects) }
}
