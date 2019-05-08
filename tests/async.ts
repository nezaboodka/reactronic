import { all } from "../src/internal/z.index";
import { stateful, transaction, cache, Renew, Isolation, Monitor, monitor, Transaction } from "../src/z.index";
import { sleep } from "./common";

export const actual: string[] = [];

const demoMon = Transaction.run(() => new Monitor("demo"));

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

  @cache(Renew.OnDemand)
  async render(): Promise<string[]> {
    let result: string[] = [];
    result.push(`Url: ${this.model.url}`);
    await sleep(10);
    result.push(`Log: ${this.model.log.join(", ")}`);
    // throw new Error("test");
    return result;
  }

  @cache(Renew.Immediately, Isolation.StandaloneTransaction)
  async print(): Promise<void> {
    let lines: string[] = await this.render();
    for (let x of lines) {
      actual.push(demoMon.isIdle ? x : `[...] ${x}`);
      // console.log(demoMon.isIdle ? x : `[...] ${x}`);
    }
  }
}
