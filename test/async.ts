// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { stateful, action, trigger, cached, cachedArgs, delay, status,
  reentrance, Status, Reentrance, Tools as RT, all, sleep } from '../source/.index'
export { tracing } from './common'

export const output: string[] = []
export const loading = Status.create("loading", 0)

@stateful
export class DemoModel {
  url: string = "reactronic"
  log: string[] = ["RTA"]

  @action @status(loading) @reentrance(Reentrance.PreventWithError)
  async load(url: string, delay: number): Promise<void> {
    this.url = url
    await all([sleep(delay)])
    this.log.push(`${this.url}/${delay}`)
  }
}

export class DemoView {
  @stateful test: any
  constructor(readonly model: DemoModel) { }

  @trigger @delay(-1)
  async print(): Promise<void> {
    const lines: string[] = await this.render()
    for (const x of lines) {
      output.push(x) /* istanbul ignore next */
      if (RT.isTraceOn && !RT.trace.silent) console.log(x)
    }
  }

  @cached @cachedArgs(false)
  async render(): Promise<string[]> {
    const result: string[] = []
    result.push(`${loading.busy ? "[...] " : ""}Url: ${this.model.url}`)
    await sleep(10)
    result.push(`${loading.busy ? "[...] " : ""}Log: ${this.model.log.join(", ")}`)
    return result
  }
}
