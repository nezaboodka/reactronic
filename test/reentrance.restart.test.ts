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
  '[...] Url: google.com',
  '[...] Log: RTA, google.com/300',
  '[...] Url: microsoft.com',
  '[...] Log: RTA, google.com/300, microsoft.com/200',
  'Url: nezaboodka.com',
  'Log: RTA, google.com/300, microsoft.com/200, nezaboodka.com/500',
]

test('reentrance.restart', async t => {
  R.setLoggingMode(true, TestingLogLevel)
  const app = Tran.run(() => {
    const a = new AsyncDemoView(new AsyncDemo())
    R.getMethodCache(a.model.load).configure({reentrance: Reentrance.WaitAndRestart})
    return a
  })
  try {
    await app.print() // initial run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(busy.workerCount, 1)
    t.is(busy.workers.size, 1)
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
      R.dispose(app)
      R.dispose(app.model)
    })
  } /* istanbul ignore next */
  if (!R.loggingOptions.silent) {
    console.log('\nResults:\n')
    for (const x of output)
      console.log(x)
    console.log('\n')
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (R.isLogging && !R.loggingOptions.silent) console.log(`actual[${i}] = \x1b[32m${output[i]}\x1b[0m,    expected[${i}] = \x1b[33m${expected[i]}\x1b[0m`)
    t.is(output[i], expected[i])
  }
})
