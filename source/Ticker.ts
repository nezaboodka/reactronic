// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Stateful, Monitor } from './core/.index'
import { Action } from './Action'

export abstract class Ticker extends Stateful {
  abstract readonly busy: boolean
  abstract readonly count: number
  abstract readonly workers: ReadonlySet<Worker>
  abstract readonly ticks: number
  abstract enter(worker: Worker): void
  abstract leave(worker: Worker): void

  static create(hint?: string): Ticker { return Monitor.create(hint) }
}

export interface Worker {
  readonly action: Action
}
