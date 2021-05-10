// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { ObservableObject, cached, Transaction, Reactronic as R, trace, reaction, plain, noSideEffects } from 'api'
import { TestingTraceLevel } from './brief'

export class DemoBase extends ObservableObject {
  @plain raw: string = 'plain data'
  title: string = 'Demo'
  sideEffect: string = 'no side effect'
  uninitialized?: any

  @reaction
  normalizeTitle(): void {
    const stamp = new Date().toUTCString()
    const t = this.title.toLowerCase()
    this.title = `${t} - ${stamp}`
  }

  @reaction @noSideEffects(true)
  reactionWithNoSideEffects(): void {
    this.sideEffect = 'side effect'
  }

  // @operation
  // setUninitialized(value: any): void {
  //   this.uninitialized = value
  // }

  @cached
  cachedTitle(): string {
    return this.title
  }

  @cached @trace({})
  produceSideEffect(): void {
    this.raw = R.why()
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
  @reaction
  oneMoreReaction(): void {
    // do nothing, the reaction is just to test inheritance chain
  }
}

test('caching', t => {
  R.setTraceMode(true, TestingTraceLevel)
  const demo = Transaction.run(() => {
    const d = new Demo()
    t.is(d.cachedTitle(), 'Demo')
    // d.title = 'Demo+'
    // t.is(d.cachedTitle(), 'Demo') // cache still returns previously cached value
    return d
  })
  t.is(demo.sideEffect, 'no side effect')
  t.assert(demo.title.startsWith('demo -')) // check that Demo.normalizeTitle works
  t.throws(() => demo.produceSideEffect(), { message: 'Demo.produceSideEffect #22 should not have side effects (trying to change Demo.title #22t107v103)' })
  // t.throws(() => demo.setUninitialized('someValue'), { message: 'uninitialized member is detected: v103t107#21 Demo.uninitialized' })
  t.assert(demo.raw.startsWith('Demo.produceSideEffect #22t107v103   <<   called within Demo.produceSideEffect #22'))
  t.is(demo.uninitialized, undefined)
  t.is(demo.cachedMap().size, 0)
  t.is(demo.cachedSet().size, 0)
})
