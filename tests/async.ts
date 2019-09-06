import { stateful, transaction, cache, behavior, Renew, Monitor, monitor, all, sleep, Dbg } from "../src/z.index";

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

  @cache
  async render(): Promise<string[]> {
    const result: string[] = [];
    result.push(`${mon.isIdle ? "" : "[...] "}Url: ${this.model.url}`);
    await sleep(10);
    result.push(`${mon.isIdle ? "" : "[...] "}Log: ${this.model.log.join(", ")}`);
    return result;
  }

  @cache @behavior(Renew.Immediately)
  async print(): Promise<void> {
    const lines: string[] = await this.render();
    for (const x of lines) {
      output.push(x); /* istanbul ignore next */
      if (!Dbg.trace.silent) console.log(x);
    }
  }
}
