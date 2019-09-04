import test from "ava";
import { ReactiveCache, Transaction, ReentrantCall, all, sleep, Trace as T } from "../src/z.index";
import { DemoModel, DemoView, mon, output } from "./async";

const requests: Array<{ url: string, delay: number }> = [
  { url: "google.com", delay: 300 },
  { url: "microsoft.com", delay: 200 },
  { url: "nezaboodka.com", delay: 500 },
];

const expected: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: google.com",
  "[...] Log: RTA, google.com/300",
  "Url: google.com",
  "Log: RTA, google.com/300",
  "[...] Url: microsoft.com",
  "[...] Log: RTA, google.com/300, microsoft.com/200",
  "Url: microsoft.com",
  "Log: RTA, google.com/300, microsoft.com/200",
  "Url: nezaboodka.com",
  "Log: RTA, google.com/300, microsoft.com/200, nezaboodka.com/500",
];

test("async", async t => {
  T.level = process.env.AVA_DEBUG === undefined ? 6 : /* istanbul ignore next */ 3;
  const app = Transaction.run(() => new DemoView(new DemoModel()));
  app.model.load.rcache.configure({reentrant: ReentrantCall.WaitAndRestart});
  try {
    t.throws(() => { app.test = "testing @stateful for fields"; });
    await app.print(); // trigger first run
    const responses = requests.map(x => app.model.load(x.url, x.delay));
    t.is(mon.counter, 1);
    t.is(mon.workers.size, 1);
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
    await ReactiveCache.unmount(app, app.model).whenFinished(true);
  } /* istanbul ignore next */
  if (T.level >= 1 && T.level <= 5) {
    console.log("\nResults:\n");
    for (const x of output)
      console.log(x);
    console.log("\n");
  }
  const n: number = Math.max(output.length, expected.length);
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (T.level >= 1 && T.level <= 5) console.log(`actual[${i}] = ${output[i]}, expected[${i}] = ${expected[i]}`);
    t.is(output[i], expected[i]);
  }
});
