import { all } from "../src/internal/z.index";
import { state, transaction, cache, Renew, Isolation, Indicator, indicator } from "../src/z.index";
import { sleep } from "./common";

export const actual: string[] = [];

@state
export class DemoModel {
  url: string = "reactronic";
  log: string[] = ["RTA"];

  @transaction  @indicator(Indicator.global)
  async load(url: string, delay: number): Promise<void> {
    this.url = url;
    await all([sleep(delay)]);
    this.log.push(`${this.url}/${delay}`);
  }
}

export class DemoView {
  @state test: any;
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

  @cache(Renew.Immediately, Isolation.StartSeparateTransaction)
  async print(): Promise<void> {
    let idle = Indicator.global.isIdle;
    let lines: string[] = await this.render();
    for (let x of lines) {
      actual.push(idle ? x : `[...] ${x}`);
      // console.log(idle ? x : `[...] ${x}`);
    }
  }
}
