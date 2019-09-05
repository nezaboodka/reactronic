import test from "ava";
import { Transaction, ReentrantCall, Cache, cacheof, all, sleep, Trace as T } from "../src/z.index";
import { DemoModel, DemoView, mon, output } from "./async";

const requests: Array<{ url: string, delay: number }> = [
  { url: "nezaboodka.com", delay: 100 },
  { url: "google.com", delay: 300 },
  { url: "microsoft.com", delay: 200 },
];

const expected: string[] = [
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
  T.level = process.env.AVA_DEBUG === undefined ? 6 : /* istanbul ignore next */ 5;
  const app = Transaction.run(() => new DemoView(new DemoModel()));
  cacheof(app.model.load).configure({reentrant: ReentrantCall.RunSideBySide});
  try {
    t.throws(() => { app.test = "testing @stateful for fields"; }, "stateful properties can only be modified inside transaction");
    await app.print(); // trigger first run
    const responses = requests.map(x => app.model.load(x.url, x.delay));
    t.is(mon.counter, 3);
    t.is(mon.workers.size, 3);
    await all(responses);
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()); /* istanbul ignore next */
    if (T.level >= 1 && T.level <= 5) console.log(error.toString());
  }
  finally {
    t.is(mon.counter, 0);
    t.is(mon.workers.size, 0);
    await sleep(400);
    await Cache.unmount(app, app.model).whenFinished(true);
  } /* istanbul ignore next */
  if (T.level >= 1 && T.level <= 5)
    for (const x of output)
      console.log(x);
  const n: number = Math.max(output.length, expected.length);
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (T.level >= 1 && T.level <= 5) console.log(`actual[${i}] = ${output[i]}, expected[${i}] = ${expected[i]}`);
    t.is(output[i], expected[i]);
  }
});
