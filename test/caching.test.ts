// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Stateful, cached, Action, Tools as RT, trace } from '../source/.index'
import { tracing } from './model/common'

export class DemoBase extends Stateful {
  text: string = 'baseMethod'
  unassigned?: any // for testing purposes

  @cached @trace({})
  baseMethod(): string {
    return 'baseMethod'
    // return this.text
  }
}


export class Demo extends DemoBase {
  title: string = "title"

  @cached
  cacheWithSideEffect(): void {
    this.title = "should fail on this line"
  }
}

test("main", t => {
  RT.setTrace(tracing.noisy)
  const demo = Action.run("caching", () => {
    const m = new Demo()
    t.is(m.baseMethod(), "baseMethod")
    // t.is(m.methodOfStatefulBase(), "methodOfStatefulBase")
    return m
  })
  t.throws(() => demo.cacheWithSideEffect(), "cache must have no side effects: #21 Demo.cacheWithSideEffect should not change v102t105#21 Demo.title")
  t.throws(() => console.log(demo.unassigned), "unassigned properties are not supported: v102t104#21 Demo.unassigned is used by T1 (<none>)")
})
