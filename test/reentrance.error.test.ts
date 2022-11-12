// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Transaction, Reentrance, Rx, pause } from '../source/api'
import { AsyncDemo, AsyncDemoView, busy, output } from './reentrance'
import { TestsLoggingLevel } from './brief'

const requests: Array<{ url: string, delay: number }> = [
  { url: 'nezaboodka.com', delay: 500 },
  { url: 'google.com', delay: 300 },
  { url: 'microsoft.com', delay: 200 },
]

const expected: Array<string> = [
  'Url: reactronic',
  'Log: RTA',
  '[...] Url: reactronic',
  '[...] Log: RTA',
  'Url: nezaboodka.com',
  'Log: RTA, nezaboodka.com/500',
]

test('reentrance.error', async t => {
  Rx.setLoggingMode(true, TestsLoggingLevel)
  const app = Transaction.run(null, () => {
    const a = new AsyncDemoView(new AsyncDemo())
    Rx.getController(a.model.load).configure({reentrance: Reentrance.PreventWithError})
    return a
  })
  try {
    t.is(app.rawField, 'raw field')
    app.rawField = 'raw field updated'
    t.is(app.rawField, 'raw field updated')
    t.is(app.observableField, 'observable field')
    t.throws(() => app.observableField = 'observable field', { message: 'observable property AsyncDemoView.observableField #24 can only be modified inside transaction' })
    t.throws(() => Rx.getController(app.print).configure({ logging: TestsLoggingLevel }))
    Transaction.run(null, () => {
      Rx.getController(app.print).configure({ logging: TestsLoggingLevel })
    })
    await app.print() // initial reactive run
    t.throws(() => Rx.getController(app.print).configure({ logging: TestsLoggingLevel }))
    const first = app.model.load(requests[0].url, requests[0].delay)
    t.throws(() => { requests.slice(1).map(x => app.model.load(x.url, x.delay)) })
    t.is(busy.counter, 1)
    t.is(busy.workers.size, 1)
    await first
  }
  catch (error: any) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (Rx.isLogging && Rx.loggingOptions.enabled) console.log(error.toString())
  }
  finally {
    t.is(busy.counter, 0)
    t.is(busy.workers.size, 0)
    const r = Rx.pullLastResult(app.render)
    t.is(r && r.length, 2)
    await pause(300)
    Transaction.run(null, () => {
      Rx.dispose(app)
      Rx.dispose(app.model)
    })
  } /* istanbul ignore next */
  if (Rx.isLogging && Rx.loggingOptions.enabled)
    for (const x of output)
      console.log(x)
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (Rx.isLogging && Rx.loggingOptions.enabled) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
