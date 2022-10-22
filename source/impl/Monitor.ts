// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Worker } from '../Worker'
import { ObservableObject, Mvcc } from './Mvcc'
import { Transaction } from './Transaction'

export abstract class Monitor extends ObservableObject {
  abstract readonly isActive: boolean
  abstract readonly counter: number
  abstract readonly workers: ReadonlySet<Worker>
  abstract readonly duration: number

  static create(hint: string, activationDelay: number, deactivationDelay: number, durationResolution: number): Monitor {
    return MonitorImpl.create(hint, activationDelay, deactivationDelay, durationResolution)
  }
}

export class MonitorImpl extends Monitor {
  isActive = false
  counter = 0
  workers = new Set<Worker>()
  duration = 0
  readonly internals = {
    started: 0,
    activationDelay: -1,
    activationTimeout: undefined,
    deactivationDelay: -1,
    deactivationTimeout: undefined,
    durationResolution: 1,
  }

  enter(worker: Worker): void {
    this.counter++
    const workers = this.workers = this.workers.toMutable()
    workers.add(worker)
    MonitorImpl.activate(this, this.internals.activationDelay)
  }

  leave(worker: Worker): void {
    this.counter--
    const workers = this.workers = this.workers.toMutable()
    workers.delete(worker)
    MonitorImpl.deactivate(this, this.internals.deactivationDelay)
  }

  static create(hint: string, activationDelay: number, deactivationDelay: number, durationResolution: number): MonitorImpl {
    return Transaction.run({ hint: 'Monitor.create' },
      MonitorImpl.doCreate, hint, activationDelay, deactivationDelay, durationResolution)
  }

  static enter(mon: MonitorImpl, worker: Worker): void {
    mon.enter(worker)
  }

  static leave(mon: MonitorImpl, worker: Worker): void {
    mon.leave(worker)
  }

  // Internal

  private static doCreate(hint: string, activationDelay: number, deactivationDelay: number, durationResolution: number): MonitorImpl {
    const m = new MonitorImpl()
    Mvcc.setHint(m, hint)
    m.internals.activationDelay = activationDelay
    m.internals.deactivationDelay = deactivationDelay
    m.internals.durationResolution = durationResolution
    return m
  }

  private static activate(mon: MonitorImpl, delay: number): void {
    const active = mon.counter > 0
    if (mon.internals.started === 0 && active) {
      mon.duration = 0
      mon.internals.started = performance.now()
      MonitorImpl.tick(mon)
    }
    if (delay >= 0) {
      if (mon.internals.activationTimeout === undefined) // only once
        mon.internals.activationTimeout = setTimeout(() =>
          Transaction.run<void>({ hint: 'Monitor.activate', separation: 'isolated' },
            MonitorImpl.activate, mon, -1), delay) as any
    }
    else if (active)
      mon.isActive = true
  }

  private static deactivate(mon: MonitorImpl, delay: number): void {
    if (delay >= 0) {
      // Discard existing timer and start new one
      clearTimeout(mon.internals.deactivationTimeout)
      mon.internals.deactivationTimeout = setTimeout(() =>
        Transaction.run<void>({ hint: 'Monitor.deactivate', separation: 'isolated' },
          MonitorImpl.deactivate, mon, -1), delay) as any
    }
    else if (mon.counter <= 0) {
      mon.isActive = false
      mon.internals.activationTimeout = undefined
    }
    if (mon.counter === 0 && mon.internals.started !== 0) {
      const resolution = mon.internals.durationResolution
      mon.duration = Math.round(resolution * (performance.now() - mon.internals.started)) / resolution
      mon.internals.started = 0
    }
  }

  private static tick(mon: MonitorImpl): void {
    if (mon.internals.started !== 0) {
      Transaction.run(MONITOR_TICK_OPTIONS, () => {
        const resolution = mon.internals.durationResolution
        mon.duration = Math.round(resolution * (performance.now() - mon.internals.started)) / resolution
      })
      const t: any = globalThis ?? global as any
      if (t.requestAnimationFrame)
        requestAnimationFrame(() => MonitorImpl.tick(mon))
    }
  }
}

const MONITOR_TICK_OPTIONS = Object.freeze({
  hint: 'Monitor.tick',
  // logging: LoggingLevel.Debug,
})
