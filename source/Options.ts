// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { LoggingOptions } from './Logging'
export { LoggingOptions, ProfilingOptions, LogLevel } from './Logging'
import { UndoRedoLog } from './impl/UndoRedoLog'
import { Monitor } from './impl/MonitorImpl'

export interface SnapshotOptions {
  readonly hint?: string
  readonly spawn?: boolean
  readonly undoRedoLog?: UndoRedoLog
  readonly logging?: Partial<LoggingOptions>
  readonly token?: any
}

export interface CacheOptions {
  readonly kind: Kind
  readonly priority: number
  readonly noSideEffects: boolean
  readonly sensitiveArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately, Number.MAX_SAFE_INTEGER is never
  readonly reentrance: Reentrance
  readonly undoRedoLog: UndoRedoLog | null
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
  RunSideBySide = -4, // multiple simultaneous transactions are allowed
}

// export interface ObjectOptions {
//   readonly sensitivity: Sensitivity // not supported
// }

export enum Sensitivity {
  TriggerOnFinalDifferenceOnly = 0, // default
  TriggerOnFinalAndIntermediateDifference = 1,
  TriggerEvenOnSameValueAssignment = 2,
}
