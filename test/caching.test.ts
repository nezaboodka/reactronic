// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Stateful, cached, Action, Tools as RT, trace, trigger } from '../source/.index'
import { tracing } from './common'

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
  produceSideEffect(): void {
    this.title = "should fail on this line"
  }

  @trigger
  changeAfterRead(): void {
    if (this.title === "title")
      this.title = "updated title"
  }
}

test("Main", t => {
  RT.setTrace(tracing.noisy)
  const demo = Action.run("caching", () => {
    const m = new Demo()
    t.is(m.baseMethod(), "baseMethod")
    // t.is(m.methodOfStatefulBase(), "methodOfStatefulBase")
    return m
  })
  t.throws(() => demo.produceSideEffect(), "cache must have no side effects: #21 Demo.cacheWithSideEffect should not change v103t108#21 Demo.title")
  t.throws(() => console.log(demo.unassigned), "unassigned properties are not supported: v103t107#21 Demo.unassigned is used by T1 (<none>)")
})
