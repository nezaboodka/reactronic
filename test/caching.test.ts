// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Stateful, cached, Transaction as Tran, Reactronic as R, logging, LogLevel, trigger, stateless, noSideEffects } from 'api'

export class DemoBase extends Stateful {
  @stateless raw: string = 'stateless data'
  title: string = 'Demo'
  sideEffect: string = 'no side effect'
  uninitialized?: any

  @trigger
  normalizeTitle(): void {
    const stamp = new Date().toUTCString()
    const t = this.title.toLowerCase()
    this.title = `${t} - ${stamp}`
  }

  @trigger @noSideEffects(true)
  triggerNoSideEffects(): void {
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

  @cached @logging({})
  produceSideEffect(): void {
    this.raw = 'should not fail on this line'
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
  @trigger
  oneMoreTrigger(): void {
    // do nothing, the trigger is just to test inheritance chain
  }
}

test('Main', t => {
  R.setLoggingMode(true, process.env.AVA_DEBUG !== undefined ? /* istanbul ignore next */ LogLevel.Debug : LogLevel.Suppress)
  const demo = Tran.run('caching', () => {
    const d = new Demo()
    t.is(d.cachedTitle(), 'Demo')
    // d.title = 'Demo+'
    // t.is(d.cachedTitle(), 'Demo') // cache still returns previously cached value
    return d
  })
  t.is(demo.sideEffect, 'no side effect')
  t.assert(demo.title.startsWith('demo -')) // check that Demo.normalizeTitle works
  t.throws(() => demo.produceSideEffect(), undefined, 'Demo.produceSideEffect #21 should not have side effects (trying to change Demo.title #21t105v103)')
  // t.throws(() => demo.setUninitialized('someValue'), undefined, 'uninitialized member is detected: v103t107#21 Demo.uninitialized')
  t.is(demo.raw, 'should not fail on this line')
  t.is(demo.uninitialized, undefined)
  t.is(demo.cachedMap().size, 0)
  t.is(demo.cachedSet().size, 0)
})
