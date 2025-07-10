// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { LoggingOptions } from "./Logging.js"
export { LoggingLevel } from "./Logging.js"
export type { LoggingOptions, ProfilingOptions } from "./Logging.js"
import { Journal } from "./core/Journal.js"
import { Indicator } from "./core/Indicator.js"

export type SnapshotOptions = {
  readonly hint?: string
  readonly isolation?: Isolation
  readonly journal?: Journal
  readonly logging?: Partial<LoggingOptions>
  readonly token?: any
}

export type MemberOptions = {
  readonly kind: Kind
  readonly isolation: Isolation
  readonly order: number
  readonly noSideEffects: boolean
  readonly triggeringArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately, Number.MAX_SAFE_INTEGER is never
  readonly reentrance: Reentrance
  readonly allowObsoleteToFinish: boolean
  readonly journal: Journal | undefined
  readonly indicator: Indicator | null
  readonly logging?: Partial<LoggingOptions>
}

export enum Kind {
  plain = 0,
  atomic = 1,
  reaction = 2,
  cache = 3,
}

export enum Reentrance {
  preventWithError = 1, // fail with error if there is an existing call in progress (default)
  waitAndRestart = 0, // wait for existing call to finish and then restart reentrant one
  cancelPrevious = -1, // cancel previous call in favor of recent one
  cancelAndWaitPrevious = -2, // cancel previous call in favor of recent one (but wait until canceling is completed)
  overwritePrevious = -3, // allow previous to complete, but overwrite it with ignoring any conflicts
  runSideBySide = -4, // multiple simultaneous operations are allowed
}

export enum Isolation {
  joinToCurrentTransaction = 0,
  joinAsNestedTransaction = 1,
  disjoinFromOuterTransaction = 2,
  disjoinFromOuterAndInnerTransactions = 3,
  disjoinForInternalDisposal = 4,
}

// Operation

export type Operation<T> = {
  readonly options: MemberOptions
  readonly args: ReadonlyArray<any>
  readonly result: T
  readonly error: any
  readonly stamp: number
  readonly isReusable: boolean

  configure(options: Partial<MemberOptions>): MemberOptions
  markObsolete(): void
  pullLastResult(args?: any[]): T | undefined
}
