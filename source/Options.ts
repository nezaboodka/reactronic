// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { TraceOptions } from './Trace'
export { TraceOptions, ProfilingOptions, TraceLevel } from './Trace'
import { TransactionJournal } from './impl/TransactionJournal'
import { Monitor } from './impl/Monitor'

export interface SnapshotOptions {
  readonly hint?: string
  readonly separate?: boolean
  readonly journal?: TransactionJournal
  readonly trace?: Partial<TraceOptions>
  readonly token?: any
}

export interface MemberOptions {
  readonly kind: Kind
  readonly priority: number
  readonly noSideEffects: boolean
  readonly sensitiveArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately, Number.MAX_SAFE_INTEGER is never
  readonly reentrance: Reentrance
  readonly journal: TransactionJournal | undefined
  readonly monitor: Monitor | null
  readonly trace?: Partial<TraceOptions>
}

export enum Kind {
  Data = 0,
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

// export interface ObjectOptions {
//   readonly sensitivity: Sensitivity // not supported
// }

export enum Sensitivity {
  ReactOnFinalDifferenceOnly = 0, // default
  ReactOnFinalAndIntermediateDifference = 1,
  ReactEvenOnSameValueAssignment = 2,
}
