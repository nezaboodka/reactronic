import { all, Trace as T } from "../src/internal/z.index";
import { stateful, transaction, cache, behavior, Renew, Monitor, monitor } from "../src/z.index";
import { sleep } from "./common";

export const output: string[] = [];

const demoMon = Monitor.create("demo");

@stateful
export class DemoModel {
  url: string = "reactronic";
  log: string[] = ["RTA"];

  @transaction  @monitor(demoMon)
  async load(url: string, delay: number): Promise<void> {
    this.url = url;
    await all([sleep(delay)]);
    this.log.push(`${this.url}/${delay}`);
  }
}

export class DemoView {
  @stateful test: any;
  constructor(readonly model: DemoModel) { }

  @cache
  async render(): Promise<string[]> {
    const result: string[] = [];
    result.push(`${demoMon.isIdle ? "" : "[...] "}Url: ${this.model.url}`);
    await sleep(10);
    result.push(`${demoMon.isIdle ? "" : "[...] "}Log: ${this.model.log.join(", ")}`);
    return result;
  }

  @cache @behavior(Renew.Immediately)
  async print(): Promise<void> {
    const lines: string[] = await this.render();
    for (const x of lines) {
      output.push(x); /* istanbul ignore next */
      if (T.level >= 1 && T.level <= 5) console.log(x);
    }
  }
}
