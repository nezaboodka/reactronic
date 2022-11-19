// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Transaction, Reentrance, Rx, all, pause } from '../source/api'
import { AsyncDemo, AsyncDemoView, busy, output } from './reentrance'
import { TestsLoggingLevel } from './brief'

const requests: Array<{ url: string, delay: number }> = [
  { url: 'nezaboodka.com', delay: 100 },
  { url: 'google.com', delay: 300 },
  { url: 'microsoft.com', delay: 200 },
]

const expected: Array<string> = [
  'Url: reactronic',
  'Log: RTA',
  '[...] Url: reactronic',
  '[...] Log: RTA',
  '[...] Url: nezaboodka.com',
  '[...] Log: RTA, nezaboodka.com/100',
  'Error: T111[AsyncDemo.load #23 - google.com] conflicts with: AsyncDemo.load #23 - nezaboodka.com (AsyncDemo.load #23t108s109t108)',
  'Url: nezaboodka.com',
  'Log: RTA, nezaboodka.com/100',
]

test('reentrance.sidebyside', async t => {
  Rx.setLoggingMode(true, TestsLoggingLevel)
  const app = Transaction.run(null, () => {
    const a = new AsyncDemoView(new AsyncDemo())
    Rx.getController(a.model.load).configure({reentrance: Reentrance.RunSideBySide})
    return a
  })
  try {
    await app.print() // initial reactive run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(busy.counter, 3)
    t.is(busy.workers.size, 3)
    await all(responses)
  }
  catch (error: any) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (Rx.isLogging && Rx.loggingOptions.enabled) console.log(error.toString())
  }
  finally {
    t.is(busy.counter, 0)
    t.is(busy.workers.size, 0)
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
    if (Rx.isLogging && Rx.loggingOptions.enabled) console.log(`actual[${i}] = \x1b[32m${output[i]}\x1b[0m,    expected[${i}] = \x1b[33m${expected[i]}\x1b[0m`)
    t.is(output[i], expected[i])
  }
})
