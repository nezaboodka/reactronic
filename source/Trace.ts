// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

export interface Trace {
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

export class TraceLevel {

  static Off: Trace | undefined = undefined

  static Basic: Trace = {
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

  static Minimal: Trace = {
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

  static Noisy: Trace = {
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

  static Suppress: Trace = {
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
