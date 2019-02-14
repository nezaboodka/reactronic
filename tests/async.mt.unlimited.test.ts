import test from "ava";
import { sleep } from "./common";
import { all } from "../src/internal/z.index";
import { Reactronic, Transaction, Log, AsyncCalls } from "../src/z.index";
import { DemoModel, DemoView, actual } from "./async";

let etalon: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "[...] Url: nezaboodka.com",
  "[...] Log: RTA, nezaboodka.com/100",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/100",
  "Error: t29'recache conflicts with other transactions on: t23'DemoModel#22.url, t23'DemoModel#22.log",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/100",
];

test("async", async t => {
  Log.verbosity = process.env.AVA_DEBUG === undefined ? 0 : 1;
  let app = Transaction.run(() => new DemoView(new DemoModel()));
  app.model.load.reactronic.configure({asyncCalls: AsyncCalls.Multiple});
  try {
    t.throws(() => { app.test = "testing @state for fields"; });
    await app.print(); // trigger first run
    let list: Array<{ url: string, delay: number }> = [
      { url: "nezaboodka.com", delay: 100 },
      { url: "google.com", delay: 300 },
      { url: "microsoft.com", delay: 200 },
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
    await Reactronic.unmount(app, app.model).whenFinished(true);
  }
  // for (let i = 0; i < actual.length; i++)
  //   console.log(actual[i]);
  let n: number = Math.max(actual.length, etalon.length);
  for (let i = 0; i < n; i++) {
    // console.log(`actual[${i}] = ${actual[i]}, etalon[${i}] = ${etalon[i]}`);
    t.is(actual[i], etalon[i]);
  }
});
