import test from "ava";
import { sleep } from "./common";
import { all } from "../src/internal/z.index";
import { ReactiveCache, Transaction, AsyncCalls, Debug } from "../src/z.index";
import { DemoModel, DemoView, actual } from "./async";

let etalon: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/500",
];

test("async", async t => {
  Debug.verbosity = process.env.AVA_DEBUG === undefined ? 0 : 5;
  let app = Transaction.run(() => new DemoView(new DemoModel()));
  app.model.load.rcache.configure({asyncCalls: AsyncCalls.Relayed});
  try {
    t.throws(() => { app.test = "testing @stateful for fields"; });
    await app.print(); // trigger first run
    let list: Array<{ url: string, delay: number }> = [
      { url: "google.com", delay: 300 },
      { url: "microsoft.com", delay: 200 },
      { url: "nezaboodka.com", delay: 500 },
    ];
    let downloads = list.map(x => app.model.load(x.url, x.delay));
    await all(downloads);
  }
  catch (error) {
    actual.push(error.toString());
    // console.log(error.toString());
  }
  finally {
    await sleep(400);
    await ReactiveCache.unmount(app, app.model).whenFinished(true);
  }
  // console.log("\nResults:\n");
  // for (let i = 0; i < actual.length; i++)
  //   console.log(actual[i]);
  let n: number = Math.max(actual.length, etalon.length);
  for (let i = 0; i < n; i++) {
    // console.log(`actual[${i}] = ${actual[i]}, etalon[${i}] = ${etalon[i]}`);
    t.is(actual[i], etalon[i]);
  }
});
