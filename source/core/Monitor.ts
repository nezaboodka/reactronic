// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Hint } from './.index'
import { Action } from '../Action'
import { Ticker, Worker } from '../Ticker'

export class Monitor extends Ticker {
  busy: boolean = false
  count: number = 0
  workers = new Set<Worker>()
  ticks: number = 0

  enter(worker: Worker): void {
    if (this.count === 0)
      this.busy = true
    this.count++
    this.workers.add(worker)
  }

  leave(worker: Worker): void {
    this.workers.delete(worker)
    this.count--
    if (this.count === 0)
      this.busy = false
  }

  static enter(m: Ticker, worker: Worker): void {
    m.enter(worker)
  }

  static leave(m: Ticker, worker: Worker): void {
    m.leave(worker)
  }

  static create(hint?: string): Monitor {
    return Action.run("Ticker.create", Monitor.createFunc, hint)
  }

  private static createFunc(hint: string | undefined): Monitor {
    return Hint.setHint(new Monitor(), hint)
  }
}
