import { stateless } from 'api'
// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Worker } from '../Worker'
import { Stateful, Hooks } from './Hooks'
import { Transaction } from './Transaction'

export abstract class Monitor extends Stateful {
  abstract readonly isActive: boolean
  abstract readonly workerCount: number
  abstract readonly workers: ReadonlySet<Worker>

  static create(hint: string, delayBeforeActive: number, delayBeforeInactive: number): Monitor {
    return MonitorImpl.create(hint, delayBeforeActive, delayBeforeInactive)
  }
}

export class MonitorImpl extends Monitor {
  isActive: boolean = false
  workerCount: number = 0
  workers = new Set<Worker>()
  @stateless delayBeforeActive: number = -1
  @stateless delayBeforeInactive: number = -1
  @stateless timeout: any = undefined

  enter(worker: Worker): void {
    this.workerCount++
    this.workers.mutable.add(worker)
    this.update(this.delayBeforeActive)
  }

  leave(worker: Worker): void {
    this.workerCount--
    this.workers.mutable.delete(worker)
    this.update(this.delayBeforeInactive)
  }

  static create(hint: string, delayBeforeActive: number, delayBeforeInactive: number): MonitorImpl {
    return Transaction.runAs({ hint: 'Monitor.create' },
      MonitorImpl.doCreate, hint, delayBeforeActive, delayBeforeInactive)
  }

  static enter(mon: MonitorImpl, worker: Worker): void {
    mon.enter(worker)
  }

  static leave(mon: MonitorImpl, worker: Worker): void {
    mon.leave(worker)
  }

  // Internal

  private static doCreate(hint: string, delayBeforeActive: number, delayBeforeInactive: number): MonitorImpl {
    const m = new MonitorImpl()
    Hooks.setHint(m, hint)
    m.delayBeforeActive = delayBeforeActive
    m.delayBeforeInactive = delayBeforeInactive
    return m
  }

  private update(delay: number): void {
    if (delay < 0)
      this.isActive = this.workerCount > 0
    else if (!this.timeout)
      this.timeout = setTimeout(() =>
        Transaction.runAs<void>({ hint: 'Monitor.update', spawn: true },
          MonitorImpl.updateTick, this), delay)
  }

  private static updateTick(mon: MonitorImpl): void {
    mon.timeout = undefined
    mon.update(-1)
  }
}
