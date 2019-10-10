// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { misuse } from '../util/Dbg'
import { Hint } from './.index'
import { Action } from '../Action'
import { Indicator } from '../Indicator'

export class IndicatorImpl extends Indicator {
  busy: boolean = false
  counter: number = 0
  actions = new Set<Action>()
  frameCount: number = 0
  prolonged?: number = undefined // milliseconds
  private timeout: any = undefined

  enter(action: Action): void {
    this.timeout = clear(this.timeout) // yes, on each enter
    if (this.counter === 0)
      this.busy = true
    this.counter++
    this.actions.add(action)
  }

  leave(action: Action): void {
    this.actions.delete(action)
    this.counter--
    if (this.counter === 0)
      this.reset(false)
  }

  private reset(now: boolean): void {
    if (now || this.prolonged === undefined) {
      if (this.counter > 0 || this.actions.size > 0) /* istanbul ignore next */
        throw misuse("cannot reset indicator having active actions")
      this.busy = false
      this.timeout = clear(this.timeout)
      this.frameCount = 0
    }
    else
      this.timeout = setTimeout(() =>
        Action.runEx<void>("Indicator.reset", true, false,
          undefined, undefined, IndicatorImpl.reset, this, true), this.prolonged)
  }

  static create(hint?: string, prolonged?: number): IndicatorImpl {
    return Action.run("Indicator.create", IndicatorImpl.doCreate, hint, prolonged)
  }

  private static doCreate(hint?: string, prolonged?: number): IndicatorImpl {
    const m = new IndicatorImpl()
    Hint.setHint(m, hint)
    m.prolonged = prolonged
    return m
  }

  static enter(ind: Indicator, action: Action): void {
    ind.enter(action)
  }

  static leave(ind: Indicator, action: Action): void {
    ind.leave(action)
  }

  static reset(ind: IndicatorImpl, now: boolean): void {
    ind.reset(now)
  }
}

function clear(timeout: any): undefined {
  clearTimeout(timeout)
  return undefined
}
