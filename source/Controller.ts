// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { MemberOptions } from './Options'

export abstract class Controller<T> {
  abstract readonly options: MemberOptions
  abstract readonly args: ReadonlyArray<any>
  abstract readonly result: T
  abstract readonly error: any
  abstract readonly stamp: number
  abstract readonly isUpToDate: boolean

  abstract configure(options: Partial<MemberOptions>): MemberOptions
  abstract markObsolete(): void
  abstract pullLastResult(args?: any[]): T | undefined
}
