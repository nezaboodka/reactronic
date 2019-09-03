import test from "ava";
import { sleep } from "./common";
import { all } from "../src/internal/z.index";
import { ReactiveCache, Transaction, ReentrantCall, Trace as T } from "../src/z.index";
import { DemoModel, DemoView, actual } from "./async";

const etalon: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "[...] Url: nezaboodka.com",
  "[...] Log: RTA, nezaboodka.com/100",
  "Error: transaction t31 (#22 DemoModel.load/microsoft.com) conflicts with other transactions on: t26#22 DemoModel.url, t26#22 DemoModel.log",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/100",
];

test("async", async t => {
  T.level = process.env.AVA_DEBUG === undefined ? 6 : /* istanbul ignore next */ 3;
  const app = Transaction.run(() => new DemoView(new DemoModel()));
  app.model.load.rcache.configure({reentrant: ReentrantCall.RunSideBySide});
  try {
    t.throws(() => { app.test = "testing @stateful for fields"; });
    await app.print(); // trigger first run
    const list: Array<{ url: string, delay: number }> = [
      { url: "nezaboodka.com", delay: 100 },
      { url: "google.com", delay: 300 },
      { url: "microsoft.com", delay: 200 },
    ];
    const downloads = list.map(x => app.model.load(x.url, x.delay));
    await all(downloads);
  }
  catch (error) {
    actual.push(error.toString());
    if (T.level >= 1 && T.level <= 5) console.log(error.toString());
  }
  finally {
    await sleep(400);
    await ReactiveCache.unmount(app, app.model).whenFinished(true);
  }
  if (T.level >= 1 && T.level <= 5)
    for (const x of actual)
      console.log(x);
  const n: number = Math.max(actual.length, etalon.length);
  for (let i = 0; i < n; i++) {
    if (T.level >= 1 && T.level <= 5) console.log(`actual[${i}] = ${actual[i]}, etalon[${i}] = ${etalon[i]}`);
    t.is(actual[i], etalon[i]);
  }
});
