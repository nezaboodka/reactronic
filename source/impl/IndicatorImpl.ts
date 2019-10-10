// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { misuse } from '../util/Dbg'
import { Hint } from './.index'
import { Action } from '../Action'
import { Indicator, Worker } from '../Indicator'

export class IndicatorImpl extends Indicator {
  throttle?: number = undefined // milliseconds
  debounce?: number = undefined // milliseconds
  busy: boolean = false
  count: number = 0
  workers = new Set<Worker>()
  ticks: number = 0
  private timeout: any = undefined

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
    if (this.count === 0)
      this.reset(false)
  }

  private reset(now: boolean): void {
    if (this.debounce === undefined || now) {
      if (this.count > 0 || this.workers.size > 0)
        throw misuse("cannot reset indicator having active workers")
      this.busy = false
      this.timeout = clear(this.timeout)
      this.ticks = 0
    }
    else
      this.timeout = setTimeout(() =>
        Action.runEx<void>("Indicator.reset", true, false,
          undefined, undefined, () => this.reset(true)), this.debounce)
  }

  static create(hint?: string, debounce?: number): IndicatorImpl {
    return Action.run("Indicator.create", IndicatorImpl.createFunc, hint, debounce)
  }

  private static createFunc(hint?: string, debounce?: number): IndicatorImpl {
    const m = new IndicatorImpl()
    Hint.setHint(m, hint)
    m.debounce = debounce
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
