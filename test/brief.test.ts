// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Operation, Kind, nonreactiveRun, isolatedRun, sensitiveRun, Sensitivity, Reactronic as R } from 'api'
import { Person, Demo, DemoView, output, TestingTraceLevel } from './brief'

const expected: string[] = [
  'Filter: Jo',
  'Filter: Jo',
  'John\'s children: Billy, Barry, Steve',
  'Filter: Jo',
  'John\'s children: Billy, Barry, Steve',
  'Filter: ',
  'John Smith\'s children: Barry, Steven Smith, William Smith',
  'Kevin\'s children: Britney',
  'Filter: ',
  'John Smith\'s children: Barry, Steven Smith, William Smith',
  'Kevin\'s children: Britney',
  'Filter: Jo',
  'John\'s children: Billy, Barry, Steve',
  'Filter: ',
  'John Smith\'s children: Barry, Steven Smith, William Smith',
  'Kevin\'s children: Britney',
]

test('brief', t => {
  R.reactionsAutoStartDisabled = !R.reactionsAutoStartDisabled
  R.reactionsAutoStartDisabled = false
  R.setProfilingMode(false)
  R.setProfilingMode(true, {})
  R.setProfilingMode(true, {
    repetitiveReadWarningThreshold: 3, // default: 10 times
    mainThreadBlockingWarningThreshold: 10, // default: 16.6 ms
    asyncActionDurationWarningThreshold: 100, // default: 150 ms
    garbageCollectionSummaryInterval: 2000, // default: 3000 ms
  })
  R.setTraceMode(false)
  R.setTraceMode(true, TestingTraceLevel)
  // Simple operations
  const app = Operation.run(() => new DemoView(new Demo()))
  try {
    t.is(R.why(), 'N/A')
    t.is(R.getController(app.print).options.priority, 123)
    t.notThrows(() => DemoView.test())
    const render = R.getController(app.render)
    t.is(render.isUpToDate, true)
    t.is(render.args.length, 1)
    t.is(render.result.length, 1)
    app.model.loadUsers()
    t.is(app.model.users.length - 1, app.model.usersWithoutLast.length)
    t.is(render.result.length, 2)
    const daddy: Person = app.model.users[0]
    t.is(daddy.hasOwnProperty('name'), true)
    t.is('name' in daddy, true)
    t.is('name2' in daddy, false)
    t.is('dummy' in daddy, true)
    t.is('dummy2' in daddy, false)
    t.is(daddy.name, 'John')
    t.is(daddy.age, 38)
    t.is(render.isUpToDate, true)
    t.is(R.takeSnapshot(daddy).age, 38)
    const stamp = render.stamp
    app.render(0)
    t.is(render.stamp, stamp)
    render.markObsolete()
    t.not(render.stamp, stamp)
    // Multi-part operations
    const op1 = Operation.create({ hint: 'op1', journal: Demo.UndoRedo })
    op1.run(() => {
      t.throws(() => op1.apply(), { message: 'cannot apply operation having active functions running' })
      app.model.shared = app.shared = op1.hint
      daddy.id = 'field restored during operation'
      daddy.id = null // restore
      daddy.age += 2 // causes no execution of DemoApp.render
      daddy.name = 'John Smith' // causes execution of DemoApp.render upon apply
      daddy.children[0].name = 'Barry' // Barry
      daddy.children[1].name = 'William Smith' // Billy
      daddy.children[2].name = 'Steven Smith' // Steve
      t.is(daddy.name, 'John Smith')
      t.is(daddy.age, 40)
      t.is(Operation.isolated(() => daddy.age), 38)
      t.is(isolatedRun(() => daddy.age), 38)
      t.is(nonreactiveRun(() => daddy.age), 40)
      t.is(daddy.children.length, 3)
      app.userFilter = 'Jo' // set to the same value
    })
    t.is(app.model.shared, op1.hint)
    t.is(daddy.name, 'John')
    t.is(op1.inspect(() => daddy.name), 'John Smith')
    t.throws(() => op1.inspect(() => { daddy.name = 'Forbidden' }), { message: 'cannot make changes during operation inspection' })
    t.is(daddy.age, 38)
    t.is(daddy.children.length, 3)
    t.is(render.isUpToDate, true)
    op1.run(() => {
      t.is(daddy.age, 40)
      daddy.age += 5
      app.userFilter = ''
      if (daddy.emails) {
        const emails = daddy.emails = daddy.emails.toMutable()
        emails[0] = 'daddy@mail.com'
        emails.push('someone@mail.io')
      }
      const attrs = daddy.attributes = daddy.attributes.toMutable()
      attrs.set('city', 'London')
      attrs.set('country', 'United Kingdom')
      const x = daddy.children[1]
      x.parent = null
      x.parent = daddy
      t.is(daddy.name, 'John Smith')
      t.is(daddy.age, 45)
      t.is(daddy.children.map(x => `"${x.name}"`).join(', '), '"Barry", "Steven Smith", "William Smith"')
      t.is(daddy.children.length, 3)
    })
    t.is(render.isUpToDate, true)
    t.is(daddy.name, 'John')
    t.is(daddy.age, 38)
    t.is(daddy.attributes.size, 0)
    op1.apply() // changes are applied, reactions are executed
    t.is(render.isUpToDate, true)
    t.not(render.stamp, stamp)
    t.is(daddy.name, 'John Smith')
    t.is(daddy.age, 45)
    t.is(daddy.attributes.size, 2)
    t.is(app.model.users !== app.model.usersWithoutLast, true)
    t.is(app.model.usersWithoutLast !== app.model.collection1, true)
    t.is(app.model.collection1 !== app.model.collection2, true)
    // Protection from modification outside of operations
    t.throws(() => {
      if (daddy.emails) {
        const emails = daddy.emails = daddy.emails.toMutable()
        emails.push('dad@mail.com')
      }
    }, undefined, 'observable property Person.emails #26 can only be modified inside operations and reactions')
    t.throws(() => op1.run(/* istanbul ignore next */() => { /* nope */ }), { message: 'cannot run operation that is already sealed' })
    // Check protection and error handling
    t.throws(() => { R.getController(daddy.setParent).configure({ monitor: null }) }, { message: 'given method is not decorated as reactronic one: setParent' })
    t.throws(() => { console.log(R.getController(daddy.setParent).options.monitor) }, { message: 'given method is not decorated as reactronic one: setParent' })
    const op2 = Operation.create({ hint: 'op2' })
    const zombi = op2.run(() => new Person())
    t.throws(() => console.log(zombi.age), { message: 'object Person #30 doesn\'t exist in snapshot v9007199254740990 (<none>)' })
    t.throws(() => op2.run(() => { throw new Error('test') }), { message: 'test' })
    t.throws(() => op2.apply(), { message: 'cannot apply operation that is already canceled: Error: test' })
    const op3 = Operation.create({ hint: 'op3' })
    t.throws(() => op3.run(() => {
      op3.cancel(new Error('test'))
      op3.run(nop)
    }), { message: 'test' })
    t.throws(() => op3.apply(), { message: 'cannot apply operation that is already canceled: Error: test' })
    Operation.run(sensitiveRun, Sensitivity.ReactEvenOnSameValueAssignment, () => {
      app.userFilter = app.userFilter
    })
    // Other
    t.throws(() => app.model.testImmutableCollection(), { message: 'use toMutable to modify sealed collection' })
    app.model.testCollectionSealing()
    t.is(app.model.collection1 === app.model.collection2, false)
    t.is(app.raw, 'DemoView.userFilter #23t125v101')
    t.is(render.options.kind, Kind.Cache)
    t.is(render.error, undefined)
    t.is(R.getTraceHint(app), 'DemoView')
    R.setTraceHint(app, 'App')
    t.is(R.getTraceHint(app, false), 'App')
    t.is(R.getTraceHint(app, true), 'App#23')
    t.deepEqual(Object.getOwnPropertyNames(app.model), ['shared', 'title', 'users', 'collection1', 'collection2', 'usersWithoutLast'])
    t.deepEqual(Object.keys(app.model), ['shared', 'title', 'users', 'collection1', 'collection2', 'usersWithoutLast'])
    t.is(Object.getOwnPropertyDescriptors(app.model).title.writable, true)
    // Undo
    t.is(app.model.title, 'Demo')
    t.is(Demo.UndoRedo.items.length, 1)
    app.model.testUndo()
    t.is(Demo.UndoRedo.items.length, 2)
    t.is(app.model.title, 'Demo - undo/redo')
    Demo.UndoRedo.undo()
    t.is(Demo.UndoRedo.items.length, 2)
    t.is(app.model.title, 'Demo')
    // Undo
    t.is(daddy.name, 'John Smith')
    t.is(daddy.age, 45)
    t.is(app.userFilter, '')
    Demo.UndoRedo.undo()
    t.is(daddy.name, 'John')
    t.is(daddy.age, 38)
    t.is(app.userFilter, 'Jo')
    Demo.UndoRedo.redo()
    t.is(daddy.name, 'John Smith')
    t.is(daddy.age, 45)
    t.is(app.userFilter, '')
    // Undo - decorator
    // op1undo.revert()
    // t.is(daddy.name, 'John Smith')
    // t.is(daddy.age, 45)
  }
  finally {
    Operation.run(() => {
      R.dispose(app.model)
      R.dispose(app)
    })
    t.is(app.model.title, undefined)
    t.is(app.userFilter, undefined)
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (R.isTraceEnabled && !R.traceOptions.silent) console.log(`actual[${i}] = \x1b[32m${output[i]}\x1b[0m,    expected[${i}] = \x1b[33m${expected[i]}\x1b[0m`)
    t.is(output[i], expected[i])
  }
})

/* istanbul ignore next */
export function nop(): void { /* do nothing */ }
