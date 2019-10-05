// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { stateful, transaction, trigger, cached, cachedArgs, latency, Reactronic as R, Monitor, monitor, all, sleep, reentrance, Reentrance } from '../source/reactronic';
export { tracing } from './common';

export const output: string[] = [];
export const mon = Monitor.create("DemoMonitor");

@stateful
export class DemoModel {
  url: string = "reactronic";
  log: string[] = ["RTA"];

  @transaction @monitor(mon) @reentrance(Reentrance.PreventWithError)
  async load(url: string, delay: number): Promise<void> {
    this.url = url;
    await all([sleep(delay)]);
    this.log.push(`${this.url}/${delay}`);
  }
}

export class DemoView {
  @stateful test: any;
  constructor(readonly model: DemoModel) { }

  @trigger @latency(-1)
  async print(): Promise<void> {
    const lines: string[] = await this.render();
    for (const x of lines) {
      output.push(x); /* istanbul ignore next */
      if (R.isTraceOn && !R.trace.silent) console.log(x);
    }
  }

  @cached @cachedArgs(false)
  async render(): Promise<string[]> {
    const result: string[] = [];
    result.push(`${mon.busy ? "[...] " : ""}Url: ${this.model.url}`);
    await sleep(10);
    result.push(`${mon.busy ? "[...] " : ""}Log: ${this.model.log.join(", ")}`);
    return result;
  }
}
