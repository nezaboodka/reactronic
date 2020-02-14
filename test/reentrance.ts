// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Stateful, state, transaction, trigger, cached, incentiveArgs, throttling, monitor,
  reentrance, Transaction as Tran, Monitor, Reentrance, Reactronic as R, all, sleep } from 'reactronic'

export const output: string[] = []
export const loading = Monitor.create('loading', 0)

export class AsyncDemo extends Stateful {
  url: string = 'reactronic'
  log: string[] = ['RTA']

  @transaction @monitor(loading) @reentrance(Reentrance.PreventWithError)
  async load(url: string, delay: number): Promise<void> {
    this.url = url
    await all([sleep(delay)])
    this.log.push(`${this.url}/${delay}`)
  }
}

export class AsyncDemoView {
  @state statefulField: string = 'stateful field'

  constructor(readonly model: AsyncDemo) {
  }

  @trigger @throttling(-1)
  async print(): Promise<void> {
    const lines: string[] = await this.render()
    if (!Tran.current.isCanceled) {
      for (const x of lines) {
        output.push(x) /* istanbul ignore next */
        if (R.isLogging && !R.loggingOptions.silent) console.log(x)
      }
    }
  }

  @cached @incentiveArgs(false)
  async render(): Promise<string[]> {
    const result: string[] = []
    result.push(`${loading.isActive ? '[...] ' : ''}Url: ${this.model.url}`)
    await sleep(10)
    result.push(`${loading.isActive ? '[...] ' : ''}Log: ${this.model.log.join(', ')}`)
    return result
  }
}
