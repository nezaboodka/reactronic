// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { CacheOptions } from './Options'

export abstract class Controller<T> {
  abstract readonly options: CacheOptions
  abstract readonly args: ReadonlyArray<any>
  abstract readonly value: T
  abstract readonly error: any
  abstract readonly stamp: number
  abstract readonly isInvalidated: boolean

  abstract configure(options: Partial<CacheOptions>): CacheOptions
  abstract invalidate(): void
  abstract getCachedValueAndRevalidate(args?: any[]): T | undefined
}
