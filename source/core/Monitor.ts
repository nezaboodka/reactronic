// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Hint } from './.index'
import { Action } from '../Action'
import { Ticker, Worker } from '../Ticker'

export class Monitor extends Ticker {
  private timeout?: NodeJS.Timeout = undefined
  interval?: number = undefined
  busy: boolean = false
  count: number = 0
  workers = new Set<Worker>()
  ticks: number = 0

  enter(worker: Worker): void {
    if (this.timeout !== undefined)
      clearTimeout(this.timeout)
    this.timeout = undefined
    if (this.count === 0)
      this.busy = true
    this.count++
    this.workers.add(worker)
  }

  leave(worker: Worker): void {
    this.workers.delete(worker)
    this.count--
    if (this.count === 0) {
      if (this.interval === undefined)
        this.busy = false
      else
        this.timeout = setTimeout(() => this.busy = false, this.interval)
    }
  }

  static enter(m: Ticker, worker: Worker): void {
    m.enter(worker)
  }

  static leave(m: Ticker, worker: Worker): void {
    m.leave(worker)
  }

  static create(hint?: string, interval?: number): Monitor {
    return Action.run("Ticker.create", Monitor.createFunc, hint, interval)
  }

  private static createFunc(hint?: string, interval?: number): Monitor {
    const m = new Monitor()
    Hint.setHint(m, hint)
    m.interval = interval
    return m
  }
}
