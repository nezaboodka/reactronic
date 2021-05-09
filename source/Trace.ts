// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

export interface TraceOptions {
  readonly silent: boolean
  readonly operation: boolean
  readonly method: boolean
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
  repetitiveReadWarningThreshold: number // default: 10 times
  mainThreadBlockingWarningThreshold: number // default: 16.6 ms
  asyncActionDurationWarningThreshold: number // default: 150 ms
  garbageCollectionSummaryInterval: number // default: 3000 ms
}

export const TraceLevel: {
  Error: TraceOptions,
  Minimal: TraceOptions,
  Info: TraceOptions,
  Debug: TraceOptions,
  Suppress: TraceOptions,
} = {

  Error: {
    silent: false,
    operation: false,
    method: false,
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

  Minimal: {
    silent: false,
    operation: true,
    method: false,
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

  Info: {
    silent: false,
    operation: true,
    method: true,
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
    silent: false,
    operation: true,
    method: true,
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

  Suppress: {
    silent: true,
    operation: false,
    method: false,
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
}

declare global {
  interface Window {
    rWhy: string
    rBriefWhy: string
  }
}
