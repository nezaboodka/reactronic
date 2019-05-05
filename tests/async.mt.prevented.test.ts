import test from "ava";
import { sleep } from "./common";
import { ReactiveCache, Transaction, AsyncCalls, Debug } from "../src/z.index";
import { DemoModel, DemoView, actual } from "./async";

let etalon: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "Url: reactronic", // TODO: To fix
  "Log: RTA", // TODO: To fix
];

test("async", async t => {
  Debug.verbosity = process.env.AVA_DEBUG === undefined ? 0 : 2;
  let app = Transaction.run(() => new DemoView(new DemoModel()));
  app.model.load.reactiveCache.configure({asyncCalls: AsyncCalls.Single});
  try {
    t.throws(() => { app.test = "testing @stateful for fields"; });
    await app.print(); // trigger first run
    let list: Array<{ url: string, delay: number }> = [
      { url: "nezaboodka.com", delay: 500 },
      { url: "google.com", delay: 300 },
      { url: "microsoft.com", delay: 200 },
    ];
    let first = app.model.load(list[0].url, list[0].delay);
    t.throws(() => { list.slice(1).map(x => app.model.load(x.url, x.delay)); });
    await first;
  }
  catch (error) {
    actual.push(error.toString());
    // console.log(error.toString());
  }
  finally {
    await sleep(400);
    await ReactiveCache.unmount(app, app.model).whenFinished(true);
  }
  // for (let x of actual)
  //   console.log(x);
  let n: number = Math.max(actual.length, etalon.length);
  for (let i = 0; i < n; i++) {
    // console.log(`actual[${i}] = ${actual[i]}, etalon[${i}] = ${etalon[i]}`);
    t.is(actual[i], etalon[i]);
  }
});
