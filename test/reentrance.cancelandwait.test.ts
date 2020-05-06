// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Transaction as Tran, Reentrance, Reactronic as R, all, sleep, LogLevel } from 'api'
import { AsyncDemo, AsyncDemoView, loading, output } from './reentrance'

const requests: Array<{ url: string, delay: number }> = [
  { url: 'google.com', delay: 300 },
  { url: 'microsoft.com', delay: 200 },
  { url: 'nezaboodka.com', delay: 500 },
]

const expected: string[] = [
  'Url: reactronic',
  'Log: RTA',
  '[...] Url: reactronic',
  '[...] Log: RTA',
  'Url: nezaboodka.com',
  'Log: RTA, nezaboodka.com/500',
]

test('Reentrance.CancelAndWaitPrevious', async t => {
  R.setLoggingMode(true, process.env.AVA_DEBUG !== undefined ? LogLevel.Debug : LogLevel.Suppress)
  const app = Tran.run('app', () => {
    const a = new AsyncDemoView(new AsyncDemo())
    R.getCache(a.model.load).configure({reentrance: Reentrance.CancelAndWaitPrevious})
    return a
  })
  try {
    await app.print() // trigger first run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(loading.workerCount, 1)
    t.is(loading.workers.size, 1)
    loading.workers.forEach(w =>
      t.assert(w.hint.indexOf('AsyncDemo.load #22 - ') === 0))
    await all(responses)
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (R.isLogging && !R.loggingOptions.silent) console.log(error.toString())
  }
  finally {
    t.is(loading.workerCount, 0)
    t.is(loading.workers.size, 0)
    await sleep(100)
    Tran.run('cleanup', () => {
      R.unmount(app)
      R.unmount(app.model)
    })
  } /* istanbul ignore next */
  if (R.isLogging && !R.loggingOptions.silent) {
    console.log('\nResults:\n')
    for (const x of output)
      console.log(x)
    console.log('\n')
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (R.isLogging && !R.loggingOptions.silent) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
