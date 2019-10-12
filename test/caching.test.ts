// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Stateful, cached, Action, Tools as RT, trace, trigger } from '../source/.index'
import { tracing } from './common'

export class Demo extends Stateful {
  title: string = 'title'
  unassigned?: any

  @cached @trace({})
  cachedTitle(): string {
    return 'title'
    // return this.title
  }

  @cached
  produceSideEffect(): void {
    this.title = 'should fail on this line'
  }

  @trigger
  changeAfterRead(): void {
    if (this.title === 'title')
      this.title = 'updated title'
  }
}

test('Main', t => {
  RT.setTrace(tracing.noisy)
  const demo = Action.run('caching', () => {
    const d = new Demo()
    t.is(d.cachedTitle(), 'title')
    return d
  })
  t.throws(() => demo.produceSideEffect(), 'cache must have no side effects: #21 Demo.produceSideEffect should not change v103t108#21 Demo.title')
  t.throws(() => console.log(demo.unassigned), 'unassigned properties are not supported: v103t107#21 Demo.unassigned is used by T1 (<none>)')
})
