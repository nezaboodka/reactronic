﻿// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Transaction, Reentrance, Reactronic as R, all, pause } from '../source/api'
import { AsyncDemo, AsyncDemoView, busy, output } from './reentrance'
import { TestingTraceLevel } from './brief'

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
  '[...] Url: nezaboodka.com',
  '[...] Log: RTA, nezaboodka.com/500',
  'Url: nezaboodka.com',
  'Log: RTA, nezaboodka.com/500',
]

test('reentrance.cancel', async t => {
  R.setTraceMode(true, TestingTraceLevel.Auto)
  const app = Transaction.run(() => {
    const a = new AsyncDemoView(new AsyncDemo())
    R.getController(a.print).configure({ order: 0 })
    R.getController(a.model.load).configure({reentrance: Reentrance.CancelPrevious})
    return a
  })
  try {
    await app.print() // reaction first run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(busy.counter, 3)
    t.is(busy.workers.size, 3)
    busy.workers.forEach(w =>
      t.assert(w.hint.indexOf('AsyncDemo.load #23 - ') === 0))
    await all(responses)
  }
  catch (error: any) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (R.isTraceEnabled && !R.traceOptions.silent) console.log(error.toString())
  }
  finally {
    t.is(busy.counter, 0)
    t.is(busy.workers.size, 0)
    await pause(300)
    Transaction.run(() => {
      R.dispose(app)
      R.dispose(app.model)
    })
  } /* istanbul ignore next */
  if (R.isTraceEnabled && !R.traceOptions.silent) {
    console.log('\nResults:\n')
    for (const x of output)
      console.log(x)
    console.log('\n')
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (R.isTraceEnabled && !R.traceOptions.silent) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
