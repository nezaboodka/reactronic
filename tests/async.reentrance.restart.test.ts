// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava';
import { Transaction, Reentrance, Status, statusof, all, sleep } from '../source/reactronic';
import { DemoModel, DemoView, mon, output, trace } from './async';

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
  Status.setTrace(trace.noisy);
  const app = Transaction.run("app", () => new DemoView(new DemoModel()));
  statusof(app.model.load).configure({reentrance: Reentrance.WaitAndRestart});
  try {
    t.throws(() => { app.test = "testing @stateful for fields"; },
      "stateful property #23 DemoView.test can only be modified inside transaction");
    await app.print(); // trigger first run
    const responses = requests.map(x => app.model.load(x.url, x.delay));
    t.is(mon.counter, 1);
    t.is(mon.workers.size, 1);
    await all(responses);
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()); /* istanbul ignore next */
    if (Status.isTraceOn && !Status.trace.silent) console.log(error.toString());
  }
  finally {
    t.is(mon.counter, 0);
    t.is(mon.workers.size, 0);
    await sleep(400);
    await Status.unmount(app, app.model).whenFinished(true);
  } /* istanbul ignore next */
  if (!Status.trace.silent) {
    console.log("\nResults:\n");
    for (const x of output)
      console.log(x);
    console.log("\n");
  }
  const n: number = Math.max(output.length, expected.length);
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (Status.isTraceOn && !Status.trace.silent) console.log(`actual[${i}] = ${output[i]}, expected[${i}] = ${expected[i]}`);
    t.is(output[i], expected[i]);
  }
});
