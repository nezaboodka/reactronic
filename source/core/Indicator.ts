// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2024 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Worker } from "../Worker.js"
import { ObservableObject, Mvcc } from "./Mvcc.js"
import { Transaction } from "./Transaction.js"

export abstract class Indicator extends ObservableObject {
  abstract readonly isBusy: boolean
  abstract readonly counter: number
  abstract readonly workers: ReadonlySet<Worker>
  abstract readonly busyDuration: number
  abstract whenBusy(): Promise<void>
  abstract whenIdle(): Promise<void>

  static create(hint: string, activationDelay: number, deactivationDelay: number, durationResolution: number): Indicator {
    return IndicatorImpl.create(hint, activationDelay, deactivationDelay, durationResolution)
  }
}

export class IndicatorImpl extends Indicator {
  isBusy = false
  counter = 0
  workers = new Set<Worker>()
  busyDuration = 0
  readonly internals = {
    whenBusy: undefined as Promise<void> | undefined,
    resolveWhenBusy: undefined as ((value?: void) => void) | undefined,
    whenIdle: undefined as Promise<void> | undefined,
    resolveWhenIdle: undefined as ((value?: void) => void) | undefined,
    started: 0,
    activationDelay: -1,
    activationTimeout: undefined,
    deactivationDelay: -1,
    deactivationTimeout: undefined,
    durationResolution: 1,
  }

  async whenBusy(): Promise<void> {
    if (this.internals.started === 0) {
      if (!this.internals.whenBusy) {
        this.internals.whenBusy = new Promise((resolve, reject): void => {
          this.internals.resolveWhenBusy = resolve
        })
      }
      await this.internals.whenBusy
    }
  }

  async whenIdle(): Promise<void> {
    if (this.internals.started !== 0) {
      if (!this.internals.whenIdle) {
        this.internals.whenIdle = new Promise((resolve, reject): void => {
          this.internals.resolveWhenIdle = resolve
        })
      }
      await this.internals.whenIdle
    }
  }

  enter(worker: Worker): void {
    this.counter++
    const workers = this.workers = this.workers.toMutable()
    workers.add(worker)
    IndicatorImpl.activate(this, this.internals.activationDelay)
  }

  leave(worker: Worker): void {
    this.counter--
    const workers = this.workers = this.workers.toMutable()
    workers.delete(worker)
    IndicatorImpl.deactivate(this, this.internals.deactivationDelay)
  }

  static create(hint: string, activationDelay: number, deactivationDelay: number, durationResolution: number): IndicatorImpl {
    return Transaction.run({ hint: "Indicator.create" },
      IndicatorImpl.doCreate, hint, activationDelay, deactivationDelay, durationResolution)
  }

  static enter(mon: IndicatorImpl, worker: Worker): void {
    mon.enter(worker)
  }

  static leave(mon: IndicatorImpl, worker: Worker): void {
    mon.leave(worker)
  }

  // Internal

  private static doCreate(hint: string, activationDelay: number, deactivationDelay: number, durationResolution: number): IndicatorImpl {
    const m = new IndicatorImpl()
    Mvcc.setHint(m, hint)
    m.internals.activationDelay = activationDelay
    m.internals.deactivationDelay = deactivationDelay
    m.internals.durationResolution = durationResolution
    return m
  }

  private static activate(mon: IndicatorImpl, delay: number): void {
    const active = mon.counter > 0
    if (mon.internals.started === 0 && active) {
      mon.busyDuration = 0
      mon.internals.started = performance.now()
      if (mon.internals.whenBusy) {
        const resolve = mon.internals.resolveWhenBusy!
        mon.internals.whenBusy = undefined
        mon.internals.resolveWhenBusy = undefined
        resolve()
      }
      IndicatorImpl.tick(mon)
    }
    if (delay >= 0) {
      if (mon.internals.activationTimeout === undefined) // only once
        mon.internals.activationTimeout = setTimeout(() =>
          Transaction.run<void>({ hint: "Indicator.activate", separation: "outer-and-inner" },
            IndicatorImpl.activate, mon, -1), delay) as any
    }
    else if (active)
      mon.isBusy = true
  }

  private static deactivate(mon: IndicatorImpl, delay: number): void {
    if (delay >= 0) {
      // Discard existing timer and start new one
      clearTimeout(mon.internals.deactivationTimeout)
      mon.internals.deactivationTimeout = setTimeout(() =>
        Transaction.run<void>({ hint: "Indicator.deactivate", separation: "outer-and-inner" },
          IndicatorImpl.deactivate, mon, -1), delay) as any
    }
    else if (mon.counter <= 0) {
      mon.isBusy = false
      mon.internals.activationTimeout = undefined
    }
    if (mon.counter === 0 && mon.internals.started !== 0) {
      const resolution = mon.internals.durationResolution
      mon.busyDuration = Math.round(resolution * (performance.now() - mon.internals.started)) / resolution
      mon.internals.started = 0
      if (mon.internals.whenIdle) {
        const resolve = mon.internals.resolveWhenIdle!
        mon.internals.whenIdle = undefined
        mon.internals.resolveWhenIdle = undefined
        resolve()
      }
    }
  }

  private static tick(mon: IndicatorImpl): void {
    if (mon.internals.started !== 0) {
      Transaction.run(INDICATOR_TICK_OPTIONS, () => {
        const resolution = mon.internals.durationResolution
        mon.busyDuration = Math.round(resolution * (performance.now() - mon.internals.started)) / resolution
      })
      const t: any = globalThis ?? global as any
      if (t.requestAnimationFrame)
        requestAnimationFrame(() => IndicatorImpl.tick(mon))
    }
  }
}

const INDICATOR_TICK_OPTIONS = Object.freeze({
  hint: "Indicator.tick",
  // logging: LoggingLevel.Debug,
})
