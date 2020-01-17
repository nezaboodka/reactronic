// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Trace } from 'reactronic'

export const tracing: { friendly: Trace, noisy: Trace, off: undefined } = {
  friendly: {
    silent: process.env.AVA_DEBUG === undefined,
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
  },
  noisy: {
    silent: process.env.AVA_DEBUG === undefined,
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
    gc: true,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  },
  off: undefined,
}

/* istanbul ignore next */
export function nop(): void { /* do nothing */ }
