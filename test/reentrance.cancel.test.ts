﻿// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2024 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { Reentrance, RxSystem, all, pause, transaction } from "../source/api.js"
import { AsyncDemo, AsyncDemoView, busy, output } from "./reentrance.js"
import { TestsLoggingLevel } from "./brief.js"

const requests: Array<{ url: string, delay: number }> = [
  { url: "google.com", delay: 300 },
  { url: "microsoft.com", delay: 200 },
  { url: "nezaboodka.com", delay: 500 },
]

const expected: Array<string> = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/500",
]

test("reentrance.cancel", async t => {
  RxSystem.setLoggingMode(true, TestsLoggingLevel)
  const app = transaction(() => {
    const a = new AsyncDemoView(new AsyncDemo())
    RxSystem.getOperation(a.print).configure({ order: 0 })
    RxSystem.getOperation(a.model.load).configure({reentrance: Reentrance.cancelPrevious})
    return a
  })
  try {
    await app.print() // initial reactive run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(busy.counter, 3)
    t.is(busy.workers.size, 3)
    busy.workers.forEach(w =>
      t.assert(w.hint.indexOf("AsyncDemo.load #23 - ") === 0))
    await all(responses)
  }
  catch (error: any) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (RxSystem.isLogging && RxSystem.loggingOptions.enabled) console.log(error.toString())
  }
  finally {
    t.is(busy.counter, 0)
    t.is(busy.workers.size, 0)
    await pause(300)
    transaction(() => {
      RxSystem.dispose(app)
      RxSystem.dispose(app.model)
    })
  } /* istanbul ignore next */
  if (RxSystem.isLogging && RxSystem.loggingOptions.enabled) {
    console.log("\nResults:\n")
    for (const x of output)
      console.log(x)
    console.log("\n")
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (RxSystem.isLogging && RxSystem.loggingOptions.enabled) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
