// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { ObservableObject, cached, Transaction, Rx, reactive, raw, options } from '../source/api'
import { TestsLoggingLevel } from './brief'

export class DemoBase extends ObservableObject {
  @raw raw: string = 'plain data'
  title: string = 'Demo'
  sideEffect: string = 'no side effect'
  uninitialized?: any

  @reactive
  normalizeTitle(): void {
    const stamp = new Date().toUTCString()
    const t = this.title.toLowerCase()
    this.title = `${t} - ${stamp}`
  }

  @reactive @options({ noSideEffects: true })
  reactiveWithNoSideEffects(): void {
    this.sideEffect = 'side effect'
  }

  // @transaction
  // setUninitialized(value: any): void {
  //   this.uninitialized = value
  // }

  @cached
  cachedTitle(): string {
    return this.title
  }

  @cached @options({ logging: {} })
  produceSideEffect(): void {
    this.raw = Rx.why()
    this.title = 'should fail on this line'
  }

  @cached
  cachedMap(): Map<string, any> {
    return new Map<string, any>()
  }

  @cached
  cachedSet(): Set<string> {
    return new Set<string>()
  }
}

export class Demo extends DemoBase {
  @reactive
  oneMoreReactiveFunction(): void {
    // do nothing, the reactive function is just to test inheritance chain
  }
}

test('caching', t => {
  Rx.setLoggingMode(true, TestsLoggingLevel)
  const demo = Transaction.run(null, () => {
    const d = new Demo()
    t.is(d.cachedTitle(), 'Demo')
    // d.title = 'Demo+'
    // t.is(d.cachedTitle(), 'Demo') // cache still returns previously cached value
    return d
  })
  t.is(demo.sideEffect, 'no side effect')
  t.assert(demo.title.startsWith('demo -')) // check that Demo.normalizeTitle works
  t.throws(() => demo.produceSideEffect(), { message: 'Demo.produceSideEffect #22 should not have side effects (trying to change Demo.title #22t107s103)' })
  // t.throws(() => demo.setUninitialized('someValue'), { message: 'uninitialized member is detected: t107s103#21 Demo.uninitialized' })
  t.assert(demo.raw.startsWith('Demo.produceSideEffect #22t107s103   ◀◀   T107[Demo.produceSideEffect #22]'))
  t.is(demo.uninitialized, undefined)
  t.is(demo.cachedMap().size, 0)
  t.is(demo.cachedSet().size, 0)
})
