// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { MethodOptions } from './Options'

export abstract class MethodCache<T> {
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
