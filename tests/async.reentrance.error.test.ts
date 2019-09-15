// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import test from 'ava';
import { Transaction, Reentrance, Status, resultof, statusof, sleep } from '../source/reactronic';
import { DemoModel, DemoView, mon, output, trace } from './async';

const requests: Array<{ url: string, delay: number }> = [
  { url: "nezaboodka.com", delay: 500 },
  { url: "google.com", delay: 300 },
  { url: "microsoft.com", delay: 200 },
];

const expected: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "Url: reactronic",
  "Log: RTA",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/500",
];

test("async", async t => {
  Status.pushTrace(trace);
  const app = Transaction.run("app", () => new DemoView(new DemoModel()));
  statusof(app.model.load).configure({reentrance: Reentrance.PreventWithError});
  try {
    t.throws(() => { app.test = "testing @stateful for fields"; },
      "stateful property #23 DemoView.test can only be modified inside transaction");
    await app.print(); // trigger first run
    const first = app.model.load(requests[0].url, requests[0].delay);
    t.throws(() => { requests.slice(1).map(x => app.model.load(x.url, x.delay)); });
    t.is(mon.counter, 1);
    t.is(mon.workers.size, 1);
    await first;
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()); /* istanbul ignore next */
    if (!Status.trace.silent) console.log(error.toString());
  }
  finally {
    t.is(mon.counter, 0);
    t.is(mon.workers.size, 0);
    t.is((resultof(app.render) || []).length, 2);
    await sleep(400);
    await Status.unmount(app, app.model).whenFinished(true);
  } /* istanbul ignore next */
  if (!Status.trace.silent)
    for (const x of output)
      console.log(x);
  const n: number = Math.max(output.length, expected.length);
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (!Status.trace.silent) console.log(`actual[${i}] = ${output[i]}, expected[${i}] = ${expected[i]}`);
    t.is(output[i], expected[i]);
  }
});
