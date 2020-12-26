// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { MethodOptions } from './Options'

export abstract class Controller<T> {
  abstract readonly options: MethodOptions
  abstract readonly args: ReadonlyArray<any>
  abstract readonly result: T
  abstract readonly error: any
  abstract readonly stamp: number
  abstract readonly isValid: boolean

  abstract configure(options: Partial<MethodOptions>): MethodOptions
  abstract invalidate(): void
  abstract getLastResultAndRevalidate(args?: any[]): T | undefined
}
