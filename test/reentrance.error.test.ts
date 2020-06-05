// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Transaction as Tran, Reentrance, getCachedAndRevalidate, Reactronic as R, LogLevel, sleep } from 'api'
import { AsyncDemo, AsyncDemoView, busy, output } from './reentrance'

const requests: Array<{ url: string, delay: number }> = [
  { url: 'nezaboodka.com', delay: 500 },
  { url: 'google.com', delay: 300 },
  { url: 'microsoft.com', delay: 200 },
]

const expected: string[] = [
  'Url: reactronic',
  'Log: RTA',
  '[...] Url: reactronic',
  '[...] Log: RTA',
  'Url: nezaboodka.com',
  'Log: RTA, nezaboodka.com/500',
]

test('Reentrance.PreventWithError', async t => {
  R.setLoggingMode(true, process.env.AVA_DEBUG !== undefined ? /* istanbul ignore next */ LogLevel.Debug : LogLevel.Suppress)
  const app = Tran.run('app', () => {
    const a = new AsyncDemoView(new AsyncDemo())
    R.getCache(a.model.load).configure({reentrance: Reentrance.PreventWithError})
    return a
  })
  try {
    t.is(app.statefulField, 'stateful field')
    t.throws(() => app.statefulField = 'test', undefined, 'stateful property AsyncDemoView.statefulField #23 can only be modified inside transactions and triggers')
    await app.print() // trigger first run
    const first = app.model.load(requests[0].url, requests[0].delay)
    t.throws(() => { requests.slice(1).map(x => app.model.load(x.url, x.delay)) })
    t.is(busy.workerCount, 1)
    t.is(busy.workers.size, 1)
    await first
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (R.isLogging && !R.loggingOptions.silent) console.log(error.toString())
  }
  finally {
    t.is(busy.workerCount, 0)
    t.is(busy.workers.size, 0)
    const r = getCachedAndRevalidate(app.render)
    t.is(r && r.length, 2)
    await sleep(100)
    Tran.run('cleanup', () => {
      R.unmount(app)
      R.unmount(app.model)
    })
  } /* istanbul ignore next */
  if (R.isLogging && !R.loggingOptions.silent)
    for (const x of output)
      console.log(x)
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (R.isLogging && !R.loggingOptions.silent) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
