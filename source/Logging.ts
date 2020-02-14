// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

export interface LoggingOptions {
  readonly silent: boolean
  readonly transactions: boolean
  readonly methods: boolean
  readonly steps: boolean
  readonly monitors: boolean
  readonly reads: boolean
  readonly writes: boolean
  readonly changes: boolean
  readonly invalidations: boolean
  readonly errors: boolean
  readonly warnings: boolean
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

export class LogLevel {

  static Off: LoggingOptions | undefined = undefined

  static Warnings: LoggingOptions = {
    silent: false,
    transactions: false,
    methods: false,
    steps: false,
    monitors: false,
    reads: false,
    writes: false,
    changes: false,
    invalidations: false,
    errors: true,
    warnings: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  }

  static Normal: LoggingOptions = {
    silent: false,
    transactions: true,
    methods: true,
    steps: false,
    monitors: true,
    reads: false,
    writes: false,
    changes: true,
    invalidations: true,
    errors: true,
    warnings: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  }

  static Minimal: LoggingOptions = {
    silent: false,
    transactions: false,
    methods: false,
    steps: false,
    monitors: false,
    reads: false,
    writes: false,
    changes: false,
    invalidations: true,
    errors: true,
    warnings: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  }

  static Noisy: LoggingOptions = {
    silent: false,
    transactions: true,
    methods: true,
    steps: true,
    monitors: true,
    reads: true,
    writes: true,
    changes: true,
    invalidations: true,
    errors: true,
    warnings: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  }

  static Suppress: LoggingOptions = {
    silent: true,
    transactions: false,
    methods: false,
    steps: false,
    monitors: false,
    reads: false,
    writes: false,
    changes: false,
    invalidations: false,
    errors: true,
    warnings: true,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  }
}

declare global {
  interface Window {
    rWhy: string
  }
}
