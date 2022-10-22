// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { LoggingOptions } from './Logging'
import { SeparationMode } from './impl/Data'
export { LoggingLevel } from './Logging'
export type { LoggingOptions, ProfilingOptions } from './Logging'
import { Journal } from './impl/Journal'
import { Monitor } from './impl/Monitor'

export interface SnapshotOptions {
  readonly hint?: string
  readonly separation?: SeparationMode
  readonly journal?: Journal
  readonly logging?: Partial<LoggingOptions>
  readonly token?: any
}

export interface MemberOptions {
  readonly kind: Kind
  readonly separation: SeparationMode
  readonly order: number
  readonly noSideEffects: boolean
  readonly triggeringArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately, Number.MAX_SAFE_INTEGER is never
  readonly reentrance: Reentrance
  readonly journal: Journal | undefined
  readonly monitor: Monitor | null
  readonly logging?: Partial<LoggingOptions>
}

export enum Kind {
  Plain = 0,
  Transactional = 1,
  Reactive = 2,
  Cached = 3,
}

export enum Reentrance {
  PreventWithError = 1, // fail with error if there is an existing call in progress (default)
  WaitAndRestart = 0, // wait for existing call to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous call in favor of recent one
  CancelAndWaitPrevious = -2, // cancel previous call in favor of recent one (but wait until canceling is completed)
  OverwritePrevious = -3, // allow previous to complete, but overwrite it with ignoring any conflicts
  RunSideBySide = -4, // multiple simultaneous operations are allowed
}
