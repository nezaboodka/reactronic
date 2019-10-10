// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { misuse } from '../util/Dbg'
import { Hint } from './.index'
import { Action } from '../Action'
import { Stopwatch, Worker } from '../Stopwatch'

export class StopwatchImpl extends Stopwatch {
  private timer?: NodeJS.Timeout = undefined
  delay?: number = undefined
  busy: boolean = false
  count: number = 0
  workers = new Set<Worker>()
  ticks: number = 0

  enter(worker: Worker): void {
    if (this.timer !== undefined)
      clearTimeout(this.timer) // yes, on each enter
    this.timer = undefined
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
        this.timer = setTimeout(() => this.reset(), this.delay)
    }
  }

  private reset(): void {
    if (this.count > 0 || this.workers.size > 0)
      throw misuse("cannot reset stopwatch having active workers")
    this.busy = false
    // this.count = 0
    // this.workers.clear()
    this.timer = undefined
    this.ticks = 0
  }

  static enter(m: Stopwatch, worker: Worker): void {
    m.enter(worker)
  }

  static leave(m: Stopwatch, worker: Worker): void {
    m.leave(worker)
  }

  static create(hint?: string, delay?: number): StopwatchImpl {
    return Action.run("Stopwatch.create", StopwatchImpl.createFunc, hint, delay)
  }

  private static createFunc(hint?: string, delay?: number): StopwatchImpl {
    const m = new StopwatchImpl()
    Hint.setHint(m, hint)
    m.delay = delay
    return m
  }
}
