// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { misuse } from '../util/Dbg'
import { Hints } from './Snapshot'
import { Transaction } from './TransactionImpl'
import { Monitor, Worker } from '../Monitor'

export class MonitorImpl extends Monitor {
  isActive: boolean = false
  workerCount: number = 0
  workers = new Set<Worker>()
  private readonly x: { delayBeforeIdle?: number, timeout: any } =
    { delayBeforeIdle: undefined, timeout: undefined }

  enter(worker: Worker): void {
    this.x.timeout = MonitorImpl.clear(this.x.timeout) // yes, on each enter
    if (this.workerCount === 0)
      this.isActive = true
    this.workerCount++
    this.workers.add(worker)
  }

  leave(worker: Worker): void {
    this.workers.delete(worker)
    this.workerCount--
    if (this.workerCount === 0)
      this.idle(false)
  }

  static create(hint?: string, prolonged?: number): MonitorImpl {
    return Transaction.run('Monitor.create', MonitorImpl.doCreate, hint, prolonged)
  }

  static enter(mon: MonitorImpl, worker: Worker): void {
    mon.enter(worker)
  }

  static leave(mon: MonitorImpl, worker: Worker): void {
    mon.leave(worker)
  }

  // Internal

  private static doCreate(hint?: string, delayBeforeIdle?: number): MonitorImpl {
    const m = new MonitorImpl()
    Hints.setHint(m, hint)
    m.x.delayBeforeIdle = delayBeforeIdle
    return m
  }

  private idle(now: boolean): void {
    if (now || this.x.delayBeforeIdle === undefined) {
      if (this.workerCount > 0 || this.workers.size > 0) /* istanbul ignore next */
        throw misuse('cannot reset monitor having active workers')
      this.isActive = false
      this.x.timeout = MonitorImpl.clear(this.x.timeout)
    }
    else
      this.x.timeout = setTimeout(() =>
        Transaction.runAs<void>('Monitor.idle', true,
          undefined, undefined, MonitorImpl.idle, this, true), this.x.delayBeforeIdle)
  }

  private static idle(mon: MonitorImpl, now: boolean): void {
    mon.idle(now)
  }

  private static clear(timeout: any): undefined {
    clearTimeout(timeout)
    return undefined
  }
}
