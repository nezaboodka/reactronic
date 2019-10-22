// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { State, cached, Action, Tools as RT, trace, trigger } from '../source/.index'
import { tracing } from './common'

export class Demo extends State {
  title: string = 'Demo'
  unassigned?: any

  @trigger
  normalizeTitle(): void {
    const stamp = new Date().toUTCString()
    const t = this.title.toLowerCase()
    this.title = `${t} - ${stamp}`
  }

  @cached
  cachedTitle(): string {
    return this.title
  }

  @cached @trace({})
  produceSideEffect(): void {
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

test('Main', t => {
  RT.setTrace(tracing.noisy)
  const demo = Action.run('caching', () => {
    const d = new Demo()
    t.is(d.cachedTitle(), 'Demo')
    return d
  })
  t.assert(demo.title.startsWith('demo -')) // check that Demo.normalizeTitle works
  t.throws(() => demo.produceSideEffect(), 'cache must have no side effects: #21 Demo.produceSideEffect should not change v103t104#21 Demo.title')
  t.throws(() => console.log(demo.unassigned), 'unassigned properties are not supported: v1t103#21 Demo.unassigned is used by T1 (<none>)')
  t.is(demo.cachedMap().size, 0)
  t.is(demo.cachedSet().size, 0)
})
