// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Action, Cache, Reentrance, Tools as RT, all, sleep } from '../source/.index'
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
  '[...] Url: reactronic',
  '[...] Log: RTA',
  'Url: nezaboodka.com',
  'Log: RTA, nezaboodka.com/500',
]

test('Reentrance.CancelPrevious', async t => {
  RT.setTrace(tracing.noisy)
  const app = Action.run('app', () => new AsyncDemoView(new AsyncDemo()))
  Cache.of(app.model.load).setup({reentrance: Reentrance.CancelPrevious})
  try {
    await app.print() // trigger first run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(loading.workerCount, 3)
    t.is(loading.workers.size, 3)
    await all(responses)
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (RT.isTraceOn && !RT.trace.silent) console.log(error.toString())
  }
  finally {
    t.is(loading.workerCount, 0)
    t.is(loading.workers.size, 0)
    await sleep(400)
    await Cache.unmount(app, app.model).whenFinished()
  } /* istanbul ignore next */
  if (RT.isTraceOn && !RT.trace.silent) {
    console.log('\nResults:\n')
    for (const x of output)
      console.log(x)
    console.log('\n')
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (RT.isTraceOn && !RT.trace.silent) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
