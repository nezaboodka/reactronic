// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Hint, Stateful } from './core/.index'
import { Action } from './Action'

export class Monitor extends Stateful {
  private counter: number = 0
  private actions = new Set<Worker>()
  busy: boolean = false
  get count(): number { return this.counter }
  get workers(): ReadonlySet<Worker> { return this.actions }

  static create(hint?: string): Monitor {
    return Action.run("Monitor.create", Monitor.createFunc, hint)
  }

  static enter(m: Monitor, worker: Worker): void {
    if (m.counter === 0)
      m.busy = true
    m.counter++
    m.actions.add(worker)
  }

  static leave(m: Monitor, worker: Worker): void {
    m.actions.delete(worker)
    m.counter--
    if (m.counter === 0)
      m.busy = false
  }

  private static createFunc(hint: string | undefined): Monitor {
    return Hint.setHint(new Monitor(), hint)
  }
}

export interface Worker {
  readonly action: Action
}
