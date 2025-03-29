// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { TriggeringObject, atomicBlock, reaction, cache, options, Transaction, Indicator, Reentrance, ReactiveSystem, trigger, all, pause } from "../source/api.js"

export const output: string[] = []
export const busy = Indicator.create("Busy", 0, 0, 1)

export class AsyncDemo extends TriggeringObject {
  url: string = "reactronic"
  log: string[] = ["RTA"]

  @atomicBlock @options({ indicator: busy, reentrance: Reentrance.preventWithError })
  async load(url: string, delay: number): Promise<void> {
    this.url = url
    await all([pause(delay)])
    const log = this.log = this.log.toMutable()
    log.push(`${this.url}/${delay}`)
  }
}

export class AsyncDemoView {
  rawField: string = "raw field"
  @trigger triggeringField: string = "triggering field"

  constructor(readonly model: AsyncDemo) {
  }

  @reaction @options({ throttling: -1 })
  async print(): Promise<void> {
    const lines: string[] = await this.render()
    if (!Transaction.current.isCanceled) {
      for (const x of lines) {
        output.push(x) /* istanbul ignore next */
        if (ReactiveSystem.isLogging && ReactiveSystem.loggingOptions.enabled) console.log(x)
      }
    }
  }

  @cache @options({ triggeringArgs: false })
  async render(): Promise<string[]> {
    const result: string[] = []
    result.push(`${busy.isBusy ? "[...] " : ""}Url: ${this.model.url}`)
    await pause(10)
    result.push(`${busy.isBusy ? "[...] " : ""}Log: ${this.model.log.join(", ")}`)
    return result
  }
}
