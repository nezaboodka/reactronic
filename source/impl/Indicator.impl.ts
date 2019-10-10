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
  retention?: number = undefined // milliseconds
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
    if (this.retention === undefined || now) {
      if (this.count > 0 || this.workers.size > 0) /* istanbul ignore next */
        throw misuse("cannot reset indicator having active workers")
      this.busy = false
      this.timeout = clear(this.timeout)
      this.ticks = 0
    }
    else
      this.timeout = setTimeout(() =>
        Action.runEx<void>("Indicator.reset", true, false,
          undefined, undefined, IndicatorImpl.reset, this, true), this.retention)
  }

  static create(hint?: string, retention?: number): IndicatorImpl {
    return Action.run("Indicator.create", IndicatorImpl.doCreate, hint, retention)
  }

  private static doCreate(hint?: string, retention?: number): IndicatorImpl {
    const m = new IndicatorImpl()
    Hint.setHint(m, hint)
    m.retention = retention
    return m
  }

  static enter(ind: Indicator, worker: Worker): void {
    ind.enter(worker)
  }

  static leave(ind: Indicator, worker: Worker): void {
    ind.leave(worker)
  }

  static reset(ind: IndicatorImpl, now: boolean): void {
    ind.reset(now)
  }
}

function clear(timeout: any): undefined {
  clearTimeout(timeout)
  return undefined
}
