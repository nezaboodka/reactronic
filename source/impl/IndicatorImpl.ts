// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { misuse } from '../util/Dbg'
import { Hint } from './.index'
import { Action } from '../Action'
import { Indicator, Worker } from '../Indicator'

export class IndicatorImpl extends Indicator {
  private timeout: any = undefined
  delay?: number = undefined
  busy: boolean = false
  count: number = 0
  workers = new Set<Worker>()
  ticks: number = 0

  enter(worker: Worker): void {
    this.timeout = clear(this.timeout) // yes, on each enter
    if (this.count === 0)
      this.busy = true
    this.count++
    this.workers.add(worker)
  }

  leave(worker: Worker): void {
    this.workers.delete(worker)
    this.count--
    if (this.count === 0) {
      if (this.delay === undefined)
        this.reset()
      else
        this.timeout = setTimeout(() => this.reset(), this.delay)
    }
  }

  private reset(): void {
    if (this.count > 0 || this.workers.size > 0)
      throw misuse("cannot reset indicator having active workers")
    this.busy = false
    // this.count = 0
    // this.workers.clear()
    this.timeout = clear(this.timeout)
    this.ticks = 0
  }

  static create(hint?: string, delay?: number): IndicatorImpl {
    return Action.run("Indicator.create", IndicatorImpl.createFunc, hint, delay)
  }

  private static createFunc(hint?: string, delay?: number): IndicatorImpl {
    const m = new IndicatorImpl()
    Hint.setHint(m, hint)
    m.delay = delay
    return m
  }

  static enter(m: Indicator, worker: Worker): void {
    m.enter(worker)
  }

  static leave(m: Indicator, worker: Worker): void {
    m.leave(worker)
  }
}

function clear(timeout: any): undefined {
  clearTimeout(timeout)
  return undefined
}
