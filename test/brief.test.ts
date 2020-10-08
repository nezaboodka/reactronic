// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Transaction as Tran, Kind, untracked, isolated, sensitive, Sensitivity, Reactronic as R } from 'api'
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
  R.triggersAutoStartDisabled = !R.triggersAutoStartDisabled
  R.triggersAutoStartDisabled = false
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
  // Simple transactions
  const app = Tran.run(() => new DemoView(new Demo()))
  try {
    t.is(R.why(), 'N/A')
    t.is(R.getMethodCache(app.print).options.priority, 123)
    t.notThrows(() => DemoView.test())
    const rendering = R.getMethodCache(app.render)
    t.is(rendering.invalid, false)
    t.is(rendering.args.length, 1)
    t.is(rendering.value.length, 1)
    app.model.loadUsers()
    t.is(app.model.users.length - 1, app.model.usersWithoutLast.length)
    t.is(rendering.value.length, 2)
    const daddy: Person = app.model.users[0]
    t.is(daddy.hasOwnProperty('name'), true)
    t.is('name' in daddy, true)
    t.is('name2' in daddy, false)
    t.is('dummy' in daddy, true)
    t.is('dummy2' in daddy, false)
    t.is(daddy.name, 'John')
    t.is(daddy.age, 38)
    t.is(rendering.invalid, false)
    t.is(R.takeSnapshot(daddy).age, 38)
    const stamp = rendering.stamp
    app.render(0)
    t.is(rendering.stamp, stamp)
    rendering.invalidate()
    t.not(rendering.stamp, stamp)
    // Multi-part transactions
    const tran1 = Tran.create({ hint: 'tran1', journal: Demo.UndoRedo })
    tran1.run(() => {
      t.throws(() => tran1.apply(), { message: 'cannot apply transaction having active functions running' })
      app.model.shared = app.shared = tran1.hint
      daddy.id = 'field restored during transaction'
      daddy.id = null // restore
      daddy.age += 2 // causes no execution of DemoApp.render
      daddy.name = 'John Smith' // causes execution of DemoApp.render upon apply
      daddy.children[0].name = 'Barry' // Barry
      daddy.children[1].name = 'William Smith' // Billy
      daddy.children[2].name = 'Steven Smith' // Steve
      t.is(daddy.name, 'John Smith')
      t.is(daddy.age, 40)
      t.is(Tran.isolated(() => daddy.age), 38)
      t.is(isolated(() => daddy.age), 38)
      t.is(untracked(() => daddy.age), 40)
      t.is(daddy.children.length, 3)
      app.userFilter = 'Jo' // set to the same value
    })
    t.is(app.model.shared, tran1.hint)
    t.is(daddy.name, 'John')
    t.is(tran1.inspect(() => daddy.name), 'John Smith')
    t.throws(() => tran1.inspect(() => { daddy.name = 'Forbidden' }), { message: 'cannot make changes during transaction inspection' })
    t.is(daddy.age, 38)
    t.is(daddy.children.length, 3)
    t.is(rendering.invalid, false)
    tran1.run(() => {
      t.is(daddy.age, 40)
      daddy.age += 5
      app.userFilter = ''
      if (daddy.emails) {
        daddy.emails[0] = 'daddy@mail.com'
        daddy.emails.push('someone@mail.io')
      }
      daddy.attributes.set('city', 'London')
      daddy.attributes.set('country', 'United Kingdom')
      const x = daddy.children[1]
      x.parent = null
      x.parent = daddy
      t.is(daddy.name, 'John Smith')
      t.is(daddy.age, 45)
      t.is(daddy.children.map(x => `"${x.name}"`).join(', '), '"Barry", "Steven Smith", "William Smith"')
      t.is(daddy.children.length, 3)
    })
    t.is(rendering.invalid, false)
    t.is(daddy.name, 'John')
    t.is(daddy.age, 38)
    t.is(daddy.attributes.size, 0)
    tran1.apply() // changes are applied, reactions are executed
    t.is(rendering.invalid, false)
    t.not(rendering.stamp, stamp)
    t.is(daddy.name, 'John Smith')
    t.is(daddy.age, 45)
    t.is(daddy.attributes.size, 2)
    // Protection from modification outside of transactions
    t.throws(() => {
      if (daddy.emails)
        daddy.emails.push('dad@mail.com')
    }, undefined, 'stateful property Person.emails #26 can only be modified inside transactions and triggers')
    t.throws(() => tran1.run(/* istanbul ignore next */() => { /* nope */ }), { message: 'cannot run transaction that is already sealed' })
    // Check protection and error handling
    t.throws(() => { R.getMethodCache(daddy.setParent).configure({ monitor: null }) }, { message: 'given method is not decorated as reactronic one: setParent' })
    t.throws(() => { console.log(R.getMethodCache(daddy.setParent).options.monitor) }, { message: 'given method is not decorated as reactronic one: setParent' })
    const tran2 = Tran.create({ hint: 'tran2' })
    const zombi = tran2.run(() => new Person())
    t.throws(() => console.log(zombi.age), { message: 'object Person #30 doesn\'t exist in snapshot v9007199254740990 (<none>)' })
    t.throws(() => tran2.run(() => { throw new Error('test') }), { message: 'test' })
    t.throws(() => tran2.apply(), { message: 'cannot apply transaction that is already canceled: Error: test' })
    const tran3 = Tran.create({ hint: 'tran3' })
    t.throws(() => tran3.run(() => {
      tran3.cancel(new Error('test'))
      tran3.run(nop)
    }), { message: 'test' })
    t.throws(() => tran3.apply(), { message: 'cannot apply transaction that is already canceled: Error: test' })
    Tran.run(sensitive, Sensitivity.TriggerEvenOnSameValueAssignment, () => {
      app.userFilter = app.userFilter
    })
    // Other
    t.is(app.raw, 'DemoView.userFilter #23t125v101')
    t.is(rendering.options.kind, Kind.Cached)
    t.is(rendering.error, undefined)
    t.is(R.getTraceHint(app), 'DemoView')
    R.setTraceHint(app, 'App')
    t.is(R.getTraceHint(app, false), 'App')
    t.is(R.getTraceHint(app, true), 'App#23')
    t.deepEqual(Object.getOwnPropertyNames(app.model), ['shared', 'title', 'users', 'usersWithoutLast'])
    t.deepEqual(Object.keys(app.model), ['shared', 'title', 'users', 'usersWithoutLast'])
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
    // tran1undo.revert()
    // t.is(daddy.name, 'John Smith')
    // t.is(daddy.age, 45)
  }
  finally {
    Tran.run(() => {
      R.dispose(app)
      R.dispose(app.model)
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
