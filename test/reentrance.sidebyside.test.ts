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
  { url: 'nezaboodka.com', delay: 100 },
  { url: 'google.com', delay: 300 },
  { url: 'microsoft.com', delay: 200 },
]

const expected: Array<string | undefined> = [
  'Url: reactronic',
  'Log: RTA',
  '[...] Url: reactronic',
  '[...] Log: RTA',
  '[...] Url: nezaboodka.com',
  '[...] Log: RTA, nezaboodka.com/100',
  'Error: T112[AsyncDemo.load #23 - microsoft.com] conflicts with: AsyncDemo.load #23 - nezaboodka.com (AsyncDemo.load #23t108v108t108), AsyncDemo.load #23 - nezaboodka.com (AsyncDemo.url #23t108v108), AsyncDemo.load #23 - nezaboodka.com (AsyncDemo.log #23t108v108)',
  'Url: nezaboodka.com',
  'Log: RTA, nezaboodka.com/100',
]

test('reentrance.sidebyside', async t => {
  R.setTraceMode(true, TestingTraceLevel.Auto)
  const app = Transaction.run(() => {
    const a = new AsyncDemoView(new AsyncDemo())
    R.getController(a.model.load).configure({reentrance: Reentrance.RunSideBySide})
    return a
  })
  try {
    await app.print() // reaction first run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(busy.counter, 3)
    t.is(busy.workers.size, 3)
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
  if (R.isTraceEnabled && !R.traceOptions.silent)
    for (const x of output)
      console.log(x)
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (R.isTraceEnabled && !R.traceOptions.silent) console.log(`actual[${i}] = \x1b[32m${output[i]}\x1b[0m,    expected[${i}] = \x1b[33m${expected[i]}\x1b[0m`)
    t.is(output[i], expected[i])
  }
})
