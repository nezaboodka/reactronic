// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { stateful, transaction, trigger, cached, Status, Monitor, monitor, all, sleep, behavior } from '../source/reactronic';
export { trace } from './common';

export const output: string[] = [];
export const mon = Monitor.create("demo");

@stateful
export class DemoModel {
  url: string = "reactronic";
  log: string[] = ["RTA"];

  @transaction @monitor(mon)
  async load(url: string, delay: number): Promise<void> {
    this.url = url;
    await all([sleep(delay)]);
    this.log.push(`${this.url}/${delay}`);
  }
}

export class DemoView {
  @stateful test: any;
  constructor(readonly model: DemoModel) { }

  @trigger @behavior(-1)
  async print(): Promise<void> {
    const lines: string[] = await this.render();
    for (const x of lines) {
      output.push(x); /* istanbul ignore next */
      if (!Status.trace.silent) console.log(x);
    }
  }

  @cached
  async render(): Promise<string[]> {
    const result: string[] = [];
    result.push(`${mon.isIdle ? "" : "[...] "}Url: ${this.model.url}`);
    await sleep(10);
    result.push(`${mon.isIdle ? "" : "[...] "}Log: ${this.model.log.join(", ")}`);
    return result;
  }
}
