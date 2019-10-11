// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { misuse } from '../util/Dbg'
import { Hint } from './Snapshot'
import { Transaction } from './Transaction'
import { Status, Worker } from '../Status'

export class StatusImpl extends Status {
  busy: boolean = false
  workerCount: number = 0
  workers = new Set<Worker>()
  animationFrameCount: number = 0
  delayBeforeIdle?: number = undefined // milliseconds
  private timeout: any = undefined

  enter(worker: Worker): void {
    this.timeout = clear(this.timeout) // yes, on each enter
    if (this.workerCount === 0)
      this.busy = true
    this.workerCount++
    this.workers.add(worker)
  }

  leave(worker: Worker): void {
    this.workers.delete(worker)
    this.workerCount--
    if (this.workerCount === 0)
      this.reset(false)
  }

  private reset(now: boolean): void {
    if (now || this.delayBeforeIdle === undefined) {
      if (this.workerCount > 0 || this.workers.size > 0) /* istanbul ignore next */
        throw misuse("cannot reset status having active workers")
      this.busy = false
      this.timeout = clear(this.timeout)
      this.animationFrameCount = 0
    }
    else
      this.timeout = setTimeout(() =>
        Transaction.runEx<void>("Status.reset", true, false,
          undefined, undefined, StatusImpl.reset, this, true), this.delayBeforeIdle)
  }

  static create(hint?: string, prolonged?: number): StatusImpl {
    return Transaction.run("Status.create", StatusImpl.doCreate, hint, prolonged)
  }

  private static doCreate(hint?: string, delayBeforeIdle?: number): StatusImpl {
    const m = new StatusImpl()
    Hint.setHint(m, hint)
    m.delayBeforeIdle = delayBeforeIdle
    return m
  }

  static enter(ind: Status, worker: Worker): void {
    ind.enter(worker)
  }

  static leave(ind: Status, worker: Worker): void {
    ind.leave(worker)
  }

  static reset(ind: StatusImpl, now: boolean): void {
    ind.reset(now)
  }
}

function clear(timeout: any): undefined {
  clearTimeout(timeout)
  return undefined
}
