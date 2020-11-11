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

  static create(hint: string, activationDelay: number, deactivationDelay: number): Monitor {
    return MonitorImpl.create(hint, activationDelay, deactivationDelay)
  }
}

export class MonitorImpl extends Monitor {
  isActive: boolean = false
  workerCount: number = 0
  workers = new Set<Worker>()
  internals = {
    activationDelay: -1,
    activationTimeout: undefined,
    deactivationDelay: -1,
    deactivationTimeout: undefined,
  }

  enter(worker: Worker): void {
    this.workerCount++
    const workers = this.workers = this.workers.toMutable()
    workers.add(worker)
    MonitorImpl.activate(this, this.internals.activationDelay)
  }

  leave(worker: Worker): void {
    this.workerCount--
    const workers = this.workers = this.workers.toMutable()
    workers.delete(worker)
    MonitorImpl.deactivate(this, this.internals.deactivationDelay)
  }

  static create(hint: string, activationDelay: number, deactivationDelay: number): MonitorImpl {
    return Transaction.runAs({ hint: 'Monitor.create' },
      MonitorImpl.doCreate, hint, activationDelay, deactivationDelay)
  }

  static enter(mon: MonitorImpl, worker: Worker): void {
    mon.enter(worker)
  }

  static leave(mon: MonitorImpl, worker: Worker): void {
    mon.leave(worker)
  }

  // Internal

  private static doCreate(hint: string, activationDelay: number, deactivationDelay: number): MonitorImpl {
    const m = new MonitorImpl()
    Hooks.setHint(m, hint)
    m.internals.activationDelay = activationDelay
    m.internals.deactivationDelay = deactivationDelay
    return m
  }

  private static activate(mon: MonitorImpl, delay: number): void {
    if (delay >= 0) {
      if (!mon.internals.activationTimeout) // only once
        mon.internals.activationTimeout = setTimeout(() =>
          Transaction.runAs<void>({ hint: 'Monitor.activate', spawn: true },
            MonitorImpl.activate, mon, -1), delay) as any
    }
    else if (mon.workerCount > 0)
      mon.isActive = true
  }

  private static deactivate(mon: MonitorImpl, delay: number): void {
    if (delay >= 0) {
      // Discard existing timer and start new one
      clearTimeout(mon.internals.deactivationTimeout)
      mon.internals.deactivationTimeout = setTimeout(() =>
        Transaction.runAs<void>({ hint: 'Monitor.deactivate', spawn: true },
          MonitorImpl.deactivate, mon, -1), delay) as any
    }
    else if (mon.workerCount <= 0) {
      mon.isActive = false
      mon.internals.activationTimeout = undefined
    }
  }
}
