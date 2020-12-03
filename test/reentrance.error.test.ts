// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Transaction as Tran, Reentrance, getCachedValueAndRevalidate, Reactronic as R, sleep } from 'api'
import { AsyncDemo, AsyncDemoView, busy, output } from './reentrance'
import { TestingTraceLevel } from './brief'

const requests: Array<{ url: string, delay: number }> = [
  { url: 'nezaboodka.com', delay: 500 },
  { url: 'google.com', delay: 300 },
  { url: 'microsoft.com', delay: 200 },
]

const expected: Array<string | undefined> = [
  'Url: reactronic',
  'Log: RTA',
  '[...] Url: reactronic',
  '[...] Log: RTA',
  'Url: nezaboodka.com',
  'Log: RTA, nezaboodka.com/500',
]

test('reentrance.error', async t => {
  R.setTraceMode(true, TestingTraceLevel)
  const app = Tran.run(() => {
    const a = new AsyncDemoView(new AsyncDemo())
    R.getMethodCache(a.model.load).configure({reentrance: Reentrance.PreventWithError})
    return a
  })
  try {
    // t.is(app.observableField, 'observable field')
    // t.throws(() => app.observableField = 'test', { message: 'observable property AsyncDemoView.observableField #23 can only be modified inside transactions and reactions' })
    await app.print() // reaction first run
    const first = app.model.load(requests[0].url, requests[0].delay)
    t.throws(() => { requests.slice(1).map(x => app.model.load(x.url, x.delay)) })
    t.is(busy.workerCount, 1)
    t.is(busy.workers.size, 1)
    await first
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (R.isTraceEnabled && !R.traceOptions.silent) console.log(error.toString())
  }
  finally {
    t.is(busy.workerCount, 0)
    t.is(busy.workers.size, 0)
    const r = getCachedValueAndRevalidate(app.render)
    t.is(r && r.length, 2)
    await sleep(100)
    Tran.run(() => {
      R.dispose(app)
      R.dispose(app.model)
    })
  } /* istanbul ignore next */
  if (R.isTraceEnabled && !R.traceOptions.silent)
    for (const x of output)
      console.log(x)
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (R.isTraceEnabled && !R.traceOptions.silent) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
