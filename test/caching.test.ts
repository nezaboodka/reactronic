// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { ObservableObject, atomically, reactiveProcess, cachedResult, unobservable, options, ReactiveSystem } from "../source/api.js"
import { TestsLoggingLevel } from "./brief.js"

export class DemoBase extends ObservableObject {
  @unobservable raw: string = "plain data"
  title: string = "Demo"
  sideEffect: string = "no side effect"
  uninitialized?: any

  @reactiveProcess
  normalizeTitle(): void {
    const stamp = new Date().toUTCString()
    const t = this.title.toLowerCase()
    this.title = `${t} - ${stamp}`
  }

  @reactiveProcess @options({ noSideEffects: true })
  reactiveWithNoSideEffects(): void {
    this.sideEffect = "side effect"
  }

  // @transaction
  // setUninitialized(value: any): void {
  //   this.uninitialized = value
  // }

  @cachedResult
  cachedTitle(): string {
    return this.title
  }

  @cachedResult @options({ logging: {} })
  produceSideEffect(): void {
    this.raw = ReactiveSystem.why()
    this.title = "should fail on this line"
  }

  @cachedResult
  cachedMap(): Map<string, any> {
    return new Map<string, any>()
  }

  @cachedResult
  cachedSet(): Set<string> {
    return new Set<string>()
  }
}

export class Demo extends DemoBase {
  @reactiveProcess
  oneMoreReactiveFunction(): void {
    // do nothing, the reactive function is just to test inheritance chain
  }
}

test("caching", t => {
  ReactiveSystem.setLoggingMode(true, TestsLoggingLevel)
  const demo = atomically(() => {
    const d = new Demo()
    t.is(d.cachedTitle(), "Demo")
    // d.title = 'Demo+'
    // t.is(d.cachedTitle(), 'Demo') // cache still returns previously cached value
    return d
  })
  t.is(demo.sideEffect, "no side effect")
  t.assert(demo.title.startsWith("demo -")) // check that Demo.normalizeTitle works
  t.throws(() => demo.produceSideEffect(), { message: "Demo.produceSideEffect #22 should not have side effects (trying to change Demo.title #22t107s103e103)" })
  // t.throws(() => demo.setUninitialized('someValue'), { message: 'uninitialized member is detected: t107s103#21 Demo.uninitialized' })
  t.assert(demo.raw.startsWith("Demo.produceSideEffect #22t107s103e107   ◀◀   T107[Demo.produceSideEffect #22]"))
  t.is(demo.uninitialized, undefined)
  t.is(demo.cachedMap().size, 0)
  t.is(demo.cachedSet().size, 0)
})
