// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Action, Cache, Reentrance, Tools as RT, cacheof, resolved, sleep } from '../source/.index'
import { DemoModel, DemoView, loading, output, tracing } from './async'

const requests: Array<{ url: string, delay: number }> = [
  { url: "nezaboodka.com", delay: 500 },
  { url: "google.com", delay: 300 },
  { url: "microsoft.com", delay: 200 },
]

const expected: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "[...] Url: nezaboodka.com",
  "[...] Log: RTA, nezaboodka.com/500",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/500",
]

test("async", async t => {
  RT.setTrace(tracing.noisy)
  const app = Action.run("app", () => new DemoView(new DemoModel()))
  cacheof(app.model.load).setup({reentrance: Reentrance.PreventWithError})
  try {
    t.throws(() => { app.test = "testing @stateful for fields" },
      "stateful property #23 DemoView.test can only be modified inside actions")
    await app.print() // trigger first run
    const first = app.model.load(requests[0].url, requests[0].delay)
    t.throws(() => { requests.slice(1).map(x => app.model.load(x.url, x.delay)) })
    t.is(loading.workerCount, 1)
    t.is(loading.workers.size, 1)
    await first
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (RT.isTraceOn && !RT.trace.silent) console.log(error.toString())
  }
  finally {
    t.is(loading.workerCount, 0)
    t.is(loading.workers.size, 0)
    const r = resolved(app.render)
    t.is(r && r.length, 2)
    await sleep(400)
    await Cache.unmount(app, app.model).whenFinished(true)
  } /* istanbul ignore next */
  if (RT.isTraceOn && !RT.trace.silent)
    for (const x of output)
      console.log(x)
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (RT.isTraceOn && !RT.trace.silent) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
