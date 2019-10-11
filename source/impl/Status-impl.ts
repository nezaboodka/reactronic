// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { misuse } from '../util/Dbg'
import { Hint } from './Hint'
import { Action } from '../Action'
import { Status } from '../Status'

export class StatusImpl extends Status {
  busy: boolean = false
  workerCount: number = 0
  workers = new Set<Action>()
  animationFrameCount: number = 0
  busyWrapUpDelay?: number = undefined // milliseconds
  private timeout: any = undefined

  enter(action: Action): void {
    this.timeout = clear(this.timeout) // yes, on each enter
    if (this.workerCount === 0)
      this.busy = true
    this.workerCount++
    this.workers.add(action)
  }

  leave(action: Action): void {
    this.workers.delete(action)
    this.workerCount--
    if (this.workerCount === 0)
      this.reset(false)
  }

  private reset(now: boolean): void {
    if (now || this.busyWrapUpDelay === undefined) {
      if (this.workerCount > 0 || this.workers.size > 0) /* istanbul ignore next */
        throw misuse("cannot reset status having active workers")
      this.busy = false
      this.timeout = clear(this.timeout)
      this.animationFrameCount = 0
    }
    else
      this.timeout = setTimeout(() =>
        Action.runEx<void>("Status.reset", true, false,
          undefined, undefined, StatusImpl.reset, this, true), this.busyWrapUpDelay)
  }

  static create(hint?: string, prolonged?: number): StatusImpl {
    return Action.run("Status.create", StatusImpl.doCreate, hint, prolonged)
  }

  private static doCreate(hint?: string, busyWrapUpDelay?: number): StatusImpl {
    const m = new StatusImpl()
    Hint.setHint(m, hint)
    m.busyWrapUpDelay = busyWrapUpDelay
    return m
  }

  static enter(ind: Status, action: Action): void {
    ind.enter(action)
  }

  static leave(ind: Status, action: Action): void {
    ind.leave(action)
  }

  static reset(ind: StatusImpl, now: boolean): void {
    ind.reset(now)
  }
}

function clear(timeout: any): undefined {
  clearTimeout(timeout)
  return undefined
}
