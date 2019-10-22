// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { State, action, trigger, cached, cachedArgs, delay, monitor,
  reentrance, Action, Monitor, Reentrance, Tools as RT, all, sleep } from '../source/.index'
export { tracing } from './common'

export const output: string[] = []
export const loading = Monitor.create('loading', 0)

export class AsyncDemo extends State {
  url: string = 'reactronic'
  log: string[] = ['RTA']

  @action @monitor(loading) @reentrance(Reentrance.PreventWithError)
  async load(url: string, delay: number): Promise<void> {
    this.url = url
    await all([sleep(delay)])
    this.log.push(`${this.url}/${delay}`)
  }
}

export class AsyncDemoView {
  constructor(readonly model: AsyncDemo) {
  }

  @trigger @delay(-1)
  async print(): Promise<void> {
    const lines: string[] = await this.render()
    if (!Action.current.isCanceled) {
      for (const x of lines) {
        output.push(x) /* istanbul ignore next */
        if (RT.isTraceOn && !RT.trace.silent) console.log(x)
      }
    }
  }

  @cached @cachedArgs(false)
  async render(): Promise<string[]> {
    const result: string[] = []
    result.push(`${loading.busy ? '[...] ' : ''}Url: ${this.model.url}`)
    await sleep(10)
    result.push(`${loading.busy ? '[...] ' : ''}Log: ${this.model.log.join(', ')}`)
    return result
  }
}
