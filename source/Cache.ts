// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { MethodOptions } from './Options'

export abstract class MethodCacheState<T> {
  abstract readonly options: MethodOptions
  abstract readonly args: ReadonlyArray<any>
  abstract readonly value: T
  abstract readonly error: any
  abstract readonly stamp: number
  abstract readonly invalid: boolean

  abstract configure(options: Partial<MethodOptions>): MethodOptions
  abstract invalidate(): void
  abstract getCachedAndRevalidate(args?: any[]): T | undefined
}
