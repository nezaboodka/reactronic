﻿// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { runAtomically, pause, Reentrance, ReactiveSystem, manageReactiveOperation, disposeObservableObject } from "../source/api.js"
import { AsyncDemo, AsyncDemoView, busy, output } from "./reentrance.js"
import { TestsLoggingLevel } from "./brief.js"

const requests: Array<{ url: string, delay: number }> = [
  { url: "nezaboodka.com", delay: 500 },
  { url: "google.com", delay: 300 },
  { url: "microsoft.com", delay: 200 },
]

const expected: Array<string> = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/500",
]

test("reentrance.error", async t => {
  ReactiveSystem.setLoggingMode(true, TestsLoggingLevel)
  const app = runAtomically(() => {
    const a = new AsyncDemoView(new AsyncDemo())
    manageReactiveOperation(a.model.load).configure({reentrance: Reentrance.preventWithError})
    return a
  })
  try {
    t.is(app.rawField, "raw field")
    app.rawField = "raw field updated"
    t.is(app.rawField, "raw field updated")
    t.is(app.observableField, "observable field")
    t.throws(() => app.observableField = "observable field", { message: "observable property AsyncDemoView.observableField #24 can only be modified inside transaction" })
    t.throws(() => manageReactiveOperation(app.print).configure({ logging: TestsLoggingLevel }))
    runAtomically(() => {
      manageReactiveOperation(app.print).configure({ logging: TestsLoggingLevel })
    })
    await app.print() // initial reactive run
    t.throws(() => manageReactiveOperation(app.print).configure({ logging: TestsLoggingLevel }))
    const first = app.model.load(requests[0].url, requests[0].delay)
    t.throws(() => { void requests.slice(1).map(x => app.model.load(x.url, x.delay)) })
    t.is(busy.counter, 1)
    t.is(busy.workers.size, 1)
    await first
  }
  catch (error: any) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (ReactiveSystem.isLogging && ReactiveSystem.loggingOptions.enabled) console.log(error.toString())
  }
  finally {
    t.is(busy.counter, 0)
    t.is(busy.workers.size, 0)
    const r = manageReactiveOperation(app.render).pullLastResult()
    t.is(r && r.length, 2)
    await pause(300)
    runAtomically(() => {
      disposeObservableObject(app)
      disposeObservableObject(app.model)
    })
  } /* istanbul ignore next */
  if (ReactiveSystem.isLogging && ReactiveSystem.loggingOptions.enabled)
    for (const x of output)
      console.log(x)
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (ReactiveSystem.isLogging && ReactiveSystem.loggingOptions.enabled) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
