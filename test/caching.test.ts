// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Action, Tools as RT } from '../source/.index'
import { tracing } from './model/common'
import { Demo } from './model/basic'

test("caching", t => {
  RT.setTrace(tracing.noisy)
  const demo = Action.run("caching", () => {
    const m = new Demo()
    t.is(m.methodOfStatefulBase(), "methodOfStatefulBase")
    // t.is(m.methodOfStatefulBase(), "methodOfStatefulBase")
    return m
  })
  t.throws(() => demo.cacheWithSideEffect(), "cache must have no side effects: #21 Demo.cacheWithSideEffect should not change v103t108#21 Demo.title")
  t.throws(() => console.log(demo.unassigned), "unassigned properties are not supported: v103t107#21 Demo.unassigned is used by T1 (<none>)")
})
