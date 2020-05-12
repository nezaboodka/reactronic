// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { LoggingOptions } from './Logging'
export { LoggingOptions, ProfilingOptions, LogLevel } from './Logging'
import { AssignmentSensitivity } from './impl/Data'
export { AssignmentSensitivity } from './impl/Data'
import { Monitor } from './Monitor'

export interface Options {
  readonly kind: Kind
  readonly priority: number
  readonly noSideEffects: boolean
  readonly sensitiveArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately, Number.MAX_SAFE_INTEGER is never
  readonly reentrance: Reentrance
  readonly monitor: Monitor | null
  readonly logging?: Partial<LoggingOptions>
}

export enum Kind {
  Field = 0,
  Transaction = 1,
  Trigger = 2,
  Cached = 3,
}

export enum Reentrance {
  PreventWithError = 1, // fail with error if there is an existing call in progress (default)
  WaitAndRestart = 0, // wait for existing call to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous call in favor of recent one
  CancelAndWaitPrevious = -2, // cancel previous call in favor of recent one (but wait until canceling is completed)
  OverwritePrevious = -3, // allow previous to complete, but overwrite it with ignoring any conflicts
  RunSideBySide = -4, // multiple simultaneous actions are allowed
}

export interface ObjectOptions {
  readonly assignmentSensitivity: AssignmentSensitivity
}
