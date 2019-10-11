// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Action, Cache, Tools as RT, Kind, cacheof, nonreactive, standalone } from '../source/.index'
import { Person, tracing, nop } from './common'
import { DemoModel, DemoView, output } from './basic'

const expected: string[] = [
  "Filter: Jo",
  "Filter: Jo",
  "John's children: Billy, Barry, Steve",
  "Filter: Jo",
  "John's children: Billy, Barry, Steve",
  "Filter: ",
  "John Smith's children: Barry, William Smith, Steven Smith",
  "Kevin's children: Britney",
  // "Filter: Jo",
  // "John's children: Billy, Barry, Steve",
]

test("basic", t => {
  RT.triggersAutoStartDisabled = !RT.triggersAutoStartDisabled
  RT.triggersAutoStartDisabled = false
  RT.performanceWarningThreshold = RT.performanceWarningThreshold + 1
  RT.performanceWarningThreshold = 3
  RT.setTrace(tracing.off)
  RT.setTrace(tracing.noisy)
  // Simple actions
  const app = Action.run("app", () => new DemoView(new DemoModel()))
  try {
    t.is(app.model.methodOfStatefulBase(), "methodOfStatefulBase")
    t.throws(() => app.model.cacheWithSideEffect(), "cache must have no side effects: #21 DemoModel.cacheWithSideEffect should not change v104t114#21 DemoModel.title")
    t.throws(() => console.log(app.model.unassigned), "unassigned properties are not supported: v103t113#21 DemoModel.unassigned is used by T1 (<none>)")
    t.notThrows(() => DemoView.test())
    t.assert(app.model.title.startsWith("demo -")) // check that DemoModel.normalizeTitle works
    const rendering = cacheof(app.render)
    t.is(rendering.invalid, false)
    t.is(rendering.args.length, 1)
    t.is(rendering.value.length, 1)
    app.model.loadUsers()
    t.is(rendering.value.length, 2)
    const daddy: Person = app.model.users[0]
    t.is(daddy.name, "John")
    t.is(daddy.age, 38)
    t.is(rendering.invalid, false)
    const stamp = rendering.stamp
    app.render(0)
    t.is(rendering.stamp, stamp)
    rendering.invalidate()
    t.not(rendering.stamp, stamp)
    // Multi-part actions
    const action1 = Action.create("action1")
    action1.run(() => {
      t.throws(() => action1.apply(), "cannot apply action having active actions")
      app.model.shared = app.shared = action1.hint
      daddy.age += 2 // causes no execution of DemoApp.render
      daddy.name = "John Smith" // causes execution of DemoApp.render upon apply
      daddy.children[0].name = "Barry" // Barry
      daddy.children[1].name = "William Smith" // Billy
      daddy.children[2].name = "Steven Smith" // Steve
      t.is(daddy.name, "John Smith")
      t.is(daddy.age, 40)
      t.is(Action.outside(() => daddy.age), 38)
      t.is(standalone(() => daddy.age), 38)
      t.is(nonreactive(() => daddy.age), 40)
      t.is(daddy.children.length, 3)
      app.userFilter = "Jo" // set to the same value
    })
    t.is(app.model.shared, action1.hint)
    t.is(daddy.name, "John")
    t.is(action1.inspect(() => daddy.name), "John Smith")
    t.throws(() => action1.inspect(() => { daddy.name = "Forbidden" }), "cannot make changes during action inspection")
    t.is(daddy.age, 38)
    t.is(daddy.children.length, 3)
    t.is(rendering.invalid, false)
    action1.run(() => {
      t.is(daddy.age, 40)
      daddy.age += 5
      app.userFilter = ""
      if (daddy.emails) {
        daddy.emails[0] = "daddy@mail.com"
        daddy.emails.push("someone@mail.io")
      }
      daddy.attributes.set("city", "London")
      daddy.attributes.set("country", "United Kingdom")
      const x = daddy.children[1]
      x.parent = null
      x.parent = daddy
      t.is(daddy.name, "John Smith")
      t.is(daddy.age, 45)
      t.is(daddy.children.length, 3)
    })
    t.is(rendering.invalid, false)
    t.is(daddy.name, "John")
    t.is(daddy.age, 38)
    t.is(daddy.attributes.size, 0)
    action1.apply() // changes are applied, reactions are executed
    t.is(rendering.invalid, false)
    t.not(rendering.stamp, stamp)
    t.is(daddy.name, "John Smith")
    t.is(daddy.age, 45)
    t.is(daddy.attributes.size, 2)
    // Protection from modification outside of actions
    t.throws(() => {
      if (daddy.emails)
        daddy.emails.push("dad@mail.com")
    }, "stateful property #26 Person.emails can only be modified inside actions")
    t.throws(() => action1.run(/* istanbul ignore next */ () => { /* nope */ }), "cannot run action that is already sealed")
    // // Undo action
    // tran1.undo()
    // t.is(daddy.name, "John")
    // t.is(daddy.age, 38)
    // Check protection and error handling
    t.throws(() => { cacheof(daddy.setParent).setup({status: null}) },
      "given method is not a reactronic cache")
    t.throws(() => { console.log(cacheof(daddy.setParent).options.status) },
      "given method is not a reactronic cache")
    const action2 = Action.create("action2")
    t.throws(() => action2.run(() => { throw new Error("test") }), "test")
    t.throws(() => action2.apply(),
      "cannot apply action that is already canceled: Error: test")
    const action3 = Action.create("action3")
    t.throws(() => action3.run(() => {
      action3.cancel(new Error("test"))
      action3.run(nop)
    }), "test")
    t.throws(() => action3.apply(),
      "cannot apply action that is already canceled: Error: test")
    // Other
    t.is(rendering.options.kind, Kind.Cached)
    t.is(rendering.error, undefined)
    t.is(RT.getTraceHint(app), "DemoView")
    RT.setTraceHint(app, "App")
    t.is(RT.getTraceHint(app), "App")
    t.deepEqual(Object.getOwnPropertyNames(app.model), [/*"shared",*/ "title", "users"])
    t.is(Object.getOwnPropertyDescriptors(app.model).title.writable, true)
  }
  finally { // cleanup
    Cache.unmount(app, app.model)
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (RT.isTraceOn && !RT.trace.silent) console.log(`actual[${i}] = \x1b[32m${output[i]}\x1b[0m,    expected[${i}] = \x1b[33m${expected[i]}\x1b[0m`)
    t.is(output[i], expected[i])
  }
})
