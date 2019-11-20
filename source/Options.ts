// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Trace } from './Trace'
export { Trace, TraceLevel } from './Trace'
import { Monitor } from './Monitor'

export interface Options {
  readonly kind: Kind
  readonly cachedArgs: boolean
  readonly delay: number // milliseconds, -1 is immediately, -2 is never
  readonly reentrance: Reentrance
  readonly monitor: Monitor | null
  readonly trace?: Partial<Trace>
}

export enum Kind {
  Field = 0,
  Action = 1,
  Trigger = 2,
  Cached = 3,
}

export enum Reentrance {
  PreventWithError = 1, // fail with error if there is an existing action in progress (default)
  WaitAndRestart = 0, // wait for existing action to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous action in favor of recent one
  OverridePrevious = -2, // allow previous to complete, but overwrite it with ignoring any conflicts
  RunSideBySide = -3, // multiple simultaneous actions are allowed
}
