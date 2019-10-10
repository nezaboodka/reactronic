// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Hint, Stateful } from './.index'
import { Action } from '../Action'
import { Ticker } from '../Ticker'

export class Monitor extends Stateful {
  private counter: number = 0
  private actions = new Set<Worker>()
  busy: boolean = false
  get count(): number { return this.counter }
  get workers(): ReadonlySet<Worker> { return this.actions }

  enter(worker: Worker): void {
    if (this.counter === 0)
      this.busy = true
    this.counter++
    this.actions.add(worker)
  }

  leave(worker: Worker): void {
    this.actions.delete(worker)
    this.counter--
    if (this.counter === 0)
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

export interface Worker {
  readonly action: Action
}
