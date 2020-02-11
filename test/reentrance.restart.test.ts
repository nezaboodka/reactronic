// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Transaction as Tran, Cache, Reentrance, Reactronic as R, all, sleep } from 'reactronic'
import { AsyncDemo, AsyncDemoView, loading, output, tracing } from './reentrance'

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
  '[...] Url: google.com',
  '[...] Log: RTA, google.com/300',
  '[...] Url: microsoft.com',
  '[...] Log: RTA, google.com/300, microsoft.com/200',
  'Url: nezaboodka.com',
  'Log: RTA, google.com/300, microsoft.com/200, nezaboodka.com/500',
]

test('Reentrance.WaitAndRestart', async t => {
  R.setTrace(tracing.noisy)
  const app = Tran.run('app', () => {
    const a = new AsyncDemoView(new AsyncDemo())
    Cache.of(a.model.load).setup({reentrance: Reentrance.WaitAndRestart})
    return a
  })
  try {
    await app.print() // trigger first run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(loading.workerCount, 1)
    t.is(loading.workers.size, 1)
    await all(responses)
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (R.isTraceOn && !R.trace.silent) console.log(error.toString())
  }
  finally {
    t.is(loading.workerCount, 0)
    t.is(loading.workers.size, 0)
    await sleep(100)
    Tran.run('cleanup', () => {
      Cache.unmount(app)
      Cache.unmount(app.model)
    })
  } /* istanbul ignore next */
  if (!R.trace.silent) {
    console.log('\nResults:\n')
    for (const x of output)
      console.log(x)
    console.log('\n')
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (R.isTraceOn && !R.trace.silent) console.log(`actual[${i}] = \x1b[32m${output[i]}\x1b[0m,    expected[${i}] = \x1b[33m${expected[i]}\x1b[0m`)
    t.is(output[i], expected[i])
  }
})
