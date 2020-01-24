// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Stateful, cached, Action, Reactronic as R, trace, trigger, action, stateless } from 'reactronic'
import { tracing } from './common'

export class DemoBase extends Stateful {
  @stateless raw: string = 'stateless data'
  title: string = 'Demo'
  unassigned?: any

  @trigger
  normalizeTitle(): void {
    const stamp = new Date().toUTCString()
    const t = this.title.toLowerCase()
    this.title = `${t} - ${stamp}`
  }

  @action
  setUnassigned(value: any): void {
    this.unassigned = value
  }

  @cached
  cachedTitle(): string {
    return this.title
  }

  @cached @trace({})
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
}

test('Main', t => {
  R.setTrace(tracing.noisy)
  const demo = Action.run('caching', () => {
    const d = new Demo()
    t.is(d.cachedTitle(), 'Demo')
    // d.title = 'Demo+'
    // t.is(d.cachedTitle(), 'Demo+')
    return d
  })
  t.assert(demo.title.startsWith('demo -')) // check that Demo.normalizeTitle works
  t.throws(() => demo.produceSideEffect(), 'cache must have no side effects: #21 Demo.produceSideEffect should not change v103t104#21 Demo.title')
  // t.throws(() => demo.setUnassigned('test'), 'stateful property must be initialized during object creation: Demo.unassigned')
  t.is(demo.unassigned, undefined)
  t.is(demo.raw, 'should not fail on this line')
  t.is(demo.cachedMap().size, 0)
  t.is(demo.cachedSet().size, 0)
})
