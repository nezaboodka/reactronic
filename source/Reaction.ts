// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2023 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from './util/Utils.js'
import { MemberOptions } from './Options.js'
import { reactive } from './Rx.js'

export interface AbstractReaction<T> {
  readonly options: MemberOptions
  readonly args: ReadonlyArray<any>
  readonly result: T
  readonly error: any
  readonly stamp: number
  readonly isUpToDate: boolean

  configure(options: Partial<MemberOptions>): MemberOptions
  markObsolete(): void
  pullLastResult(args?: any[]): T | undefined
}

export class Reaction<T>
{
  constructor(protected action: F<T>) {
  }

  @reactive
  protected launch(): T {
    return this.action()
  }
}
