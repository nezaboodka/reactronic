// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { LoggingOptions } from "./Logging.js"
export { LoggingLevel } from "./Logging.js"
import { Kind, Reentrance, Isolation } from "./Enums.js"
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

export type ReactivityOptions = {
  readonly kind: Kind
  readonly isolation: Isolation
  readonly order: number
  readonly noSideEffects: boolean
  readonly observableArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately, Number.MAX_SAFE_INTEGER is never
  readonly reentrance: Reentrance
  readonly allowObsoleteToFinish: boolean
  readonly journal: Journal | undefined
  readonly indicator: Indicator | null
  readonly logging?: Partial<LoggingOptions>
}

// ReactiveOperation

export type ReactiveOperation<T> = {
  readonly options: ReactivityOptions
  readonly args: ReadonlyArray<any>
  readonly result: T
  readonly error: any
  readonly stamp: number
  readonly isReusable: boolean

  configure(options: Partial<ReactivityOptions>): ReactivityOptions
  markObsolete(): void
  pullLastResult(args?: any[]): T | undefined
}
