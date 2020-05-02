// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Options } from './Options'

export abstract class Cache<T> {
  abstract readonly options: Options
  abstract readonly args: ReadonlyArray<any>
  abstract readonly value: T
  abstract readonly error: any
  abstract readonly stamp: number
  abstract readonly invalid: boolean

  abstract setup(options: Partial<Options>): Options
  abstract invalidate(): void
  abstract getCachedAndRevalidate(args?: any[]): T | undefined
}
