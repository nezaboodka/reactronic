// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

export interface LoggingOptions {
  readonly enabled: boolean
  readonly transaction: boolean
  readonly operation: boolean
  readonly step: boolean
  readonly monitor: boolean
  readonly read: boolean
  readonly write: boolean
  readonly change: boolean
  readonly obsolete: boolean
  readonly error: boolean
  readonly warning: boolean
  readonly gc: boolean
  readonly color: number
  readonly prefix: string
  readonly margin1: number
  readonly margin2: number
}

export interface ProfilingOptions {
  repetitiveUsageWarningThreshold: number // default: 10 times
  mainThreadBlockingWarningThreshold: number // default: 16.6 ms
  asyncActionDurationWarningThreshold: number // default: 150 ms
  garbageCollectionSummaryInterval: number // default: 3000 ms
}

export const LoggingLevel: {
  readonly Off: LoggingOptions,
  readonly ErrorsOnly: LoggingOptions,
  readonly Reactions: LoggingOptions,
  readonly Transactions: LoggingOptions,
  readonly Operations: LoggingOptions,
  readonly Debug: LoggingOptions,
} = {

  Off: {
    enabled: false,
    transaction: false,
    operation: false,
    step: false,
    monitor: false,
    read: false,
    write: false,
    change: false,
    obsolete: false,
    error: true,
    warning: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  },

  ErrorsOnly: {
    enabled: true,
    transaction: false,
    operation: false,
    step: false,
    monitor: false,
    read: false,
    write: false,
    change: false,
    obsolete: false,
    error: true,
    warning: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  },

  Reactions: {
    enabled: true,
    transaction: false,
    operation: false,
    step: false,
    monitor: false,
    read: false,
    write: false,
    change: false,
    obsolete: true,
    error: true,
    warning: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  },

  Transactions: {
    enabled: true,
    transaction: true,
    operation: false,
    step: false,
    monitor: false,
    read: false,
    write: false,
    change: false,
    obsolete: true,
    error: true,
    warning: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  },

  Operations: {
    enabled: true,
    transaction: true,
    operation: true,
    step: false,
    monitor: true,
    read: false,
    write: false,
    change: true,
    obsolete: true,
    error: true,
    warning: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  },

  Debug: {
    enabled: true,
    transaction: true,
    operation: true,
    step: true,
    monitor: true,
    read: true,
    write: true,
    change: true,
    obsolete: true,
    error: true,
    warning: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  },
}

declare global {
  interface Window {
    rWhy: string
    rBriefWhy: string
  }
}
