// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { LoggingOptions } from './Logging'
import { StandaloneMode } from './impl/Data'
export { LoggingOptions, ProfilingOptions, LoggingLevel } from './Logging'
import { TransactionJournal } from './impl/TransactionJournal'
import { Monitor } from './impl/Monitor'

export interface SnapshotOptions {
  readonly hint?: string
  readonly standalone?: StandaloneMode
  readonly journal?: TransactionJournal
  readonly logging?: Partial<LoggingOptions>
  readonly token?: any
}

export interface MemberOptions {
  readonly kind: Kind
  readonly standalone: StandaloneMode
  readonly order: number
  readonly noSideEffects: boolean
  readonly sensitiveArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately, Number.MAX_SAFE_INTEGER is never
  readonly reentrance: Reentrance
  readonly journal: TransactionJournal | undefined
  readonly monitor: Monitor | null
  readonly logging?: Partial<LoggingOptions>
}

export enum Kind {
  Plain = 0,
  Transaction = 1,
  Reaction = 2,
  Cache = 3,
}

export enum Reentrance {
  PreventWithError = 1, // fail with error if there is an existing call in progress (default)
  WaitAndRestart = 0, // wait for existing call to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous call in favor of recent one
  CancelAndWaitPrevious = -2, // cancel previous call in favor of recent one (but wait until canceling is completed)
  OverwritePrevious = -3, // allow previous to complete, but overwrite it with ignoring any conflicts
  RunSideBySide = -4, // multiple simultaneous operations are allowed
}
