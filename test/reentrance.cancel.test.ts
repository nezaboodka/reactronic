// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Transaction as Tran, Reentrance, Reactronic as R, all, sleep } from 'api'
import { AsyncDemo, AsyncDemoView, busy, output } from './reentrance'
import { TestingLogLevel } from './brief'

const requests: Array<{ url: string, delay: number }> = [
  { url: 'google.com', delay: 300 },
  { url: 'microsoft.com', delay: 200 },
  { url: 'nezaboodka.com', delay: 500 },
]

const expected: Array<string | undefined> = [
  'Url: reactronic',
  'Log: RTA',
  '[...] Url: reactronic',
  '[...] Log: RTA',
  'Url: nezaboodka.com',
  'Log: RTA, nezaboodka.com/500',
]

test('reentrance.cancel', async t => {
  R.setLoggingMode(true, TestingLogLevel)
  const app = Tran.run(() => {
    const a = new AsyncDemoView(new AsyncDemo())
    R.getCache(a.print).configure({ priority: 0 })
    R.getCache(a.model.load).configure({reentrance: Reentrance.CancelPrevious})
    return a
  })
  try {
    await app.print() // trigger first run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(busy.workerCount, 3)
    t.is(busy.workers.size, 3)
    busy.workers.forEach(w =>
      t.assert(w.hint.indexOf('AsyncDemo.load #22 - ') === 0))
    await all(responses)
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (R.isLogging && !R.loggingOptions.silent) console.log(error.toString())
  }
  finally {
    t.is(busy.workerCount, 0)
    t.is(busy.workers.size, 0)
    await sleep(100)
    Tran.run(() => {
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
