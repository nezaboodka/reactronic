// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Transaction, Kind, nonreactive, sensitive, Rx } from '../source/api'
import { Person, Demo, DemoView, output, TestsLoggingLevel } from './brief'

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
  Rx.reactivityAutoStartDisabled = !Rx.reactivityAutoStartDisabled
  Rx.reactivityAutoStartDisabled = false
  Rx.setProfilingMode(false)
  Rx.setProfilingMode(true, {})
  Rx.setProfilingMode(true, {
    repetitiveUsageWarningThreshold: 3, // default: 10 times
    mainThreadBlockingWarningThreshold: 10, // default: 16.6 ms
    asyncActionDurationWarningThreshold: 100, // default: 150 ms
    garbageCollectionSummaryInterval: 2000, // default: 3000 ms
  })
  Rx.setLoggingMode(false)
  Rx.setLoggingMode(true, TestsLoggingLevel)
  // Simple transactions
  const app = Transaction.run(null, () => new DemoView(new Demo()))
  try {
    t.is(Rx.why(), '<boot>')
    t.is(Rx.getController(app.print).options.order, 123)
    t.notThrows(() => DemoView.test())
    const render = Rx.getController(app.render)
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
    t.is(Rx.takeSnapshot(daddy).age, 38)
    const stamp = render.stamp
    app.render(0)
    t.is(render.stamp, stamp)
    render.markObsolete()
    t.not(render.stamp, stamp)
    // Multi-part transactions
    const tran1 = Transaction.create({ hint: 'tran1', journal: Demo.journal })
    tran1.run(() => {
      const computed = app.model.computed
      t.true(computed.startsWith('Demo.computed @ '))
      t.is(computed, app.model.computed)
      t.throws(() => tran1.apply(), { message: 'cannot apply transaction having active operations running' })
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
      t.is(Transaction.outside(() => daddy.age), 38)
      t.is(nonreactive(() => daddy.age), 40)
      t.is(daddy.children.length, 3)
      app.userFilter = 'Jo' // set to the same value
    })
    t.is(app.model.shared, tran1.hint)
    t.is(daddy.name, 'John')
    t.is(tran1.inspect(() => daddy.name), 'John Smith')
    t.throws(() => tran1.inspect(() => { daddy.name = 'Forbidden' }), { message: 'cannot make changes during transaction inspection' })
    t.is(daddy.age, 38)
    t.is(daddy.children.length, 3)
    t.is(render.isUpToDate, true)
    tran1.run(() => {
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
    tran1.apply() // changes are applied, reactive functions are executed
    t.is(render.isUpToDate, true)
    t.not(render.stamp, stamp)
    t.is(daddy.name, 'John Smith')
    t.is(daddy.age, 45)
    t.is(daddy.attributes.size, 2)
    t.is(app.model.users !== app.model.usersWithoutLast, true)
    t.is(app.model.usersWithoutLast !== app.model.collection1, true)
    t.is(app.model.collection1 !== app.model.collection2, true)
    // Protection from modification outside of transactions
    t.throws(() => {
      if (daddy.emails) {
        const emails = daddy.emails = daddy.emails.toMutable()
        emails.push('dad@mail.com')
      }
    }, undefined, 'observable property Person.emails #26 can only be modified inside transaction')
    t.throws(() => tran1.run(/* istanbul ignore next */() => { /* nope */ }), { message: 'cannot run transaction that is already sealed' })
    // Check protection and error handling
    t.throws(() => { Rx.getController(daddy.setParent).configure({ monitor: null }) }, { message: 'given method is not decorated as reactronic one: setParent' })
    t.throws(() => { console.log(Rx.getController(daddy.setParent).options.monitor) }, { message: 'given method is not decorated as reactronic one: setParent' })
    const op2 = Transaction.create({ hint: 'op2' })
    const zombi = op2.run(() => new Person())
    t.throws(() => console.log(zombi.age), { message: 'Person.age #30 is not yet available for T1[<none>] because of uncommitted T125[op2] (last committed T0[<boot>])' })
    t.throws(() => op2.run(() => { throw new Error('test') }), { message: 'test' })
    t.throws(() => op2.apply(), { message: 'cannot apply transaction that is already canceled: Error: test' })
    const op3 = Transaction.create({ hint: 'op3' })
    t.throws(() => op3.run(() => {
      op3.cancel(new Error('test'))
      op3.run(nop)
    }), { message: 'test' })
    t.throws(() => op3.apply(), { message: 'cannot apply transaction that is already canceled: Error: test' })
    Transaction.run(null, sensitive, true, () => {
      app.userFilter = app.userFilter
    })
    // Other
    t.throws(() => app.model.testImmutableCollection(), { message: 'use toMutable to create mutable copy of sealed collection' })
    app.model.testCollectionSealing()
    t.is(app.model.collection1 === app.model.collection2, false)
    t.is(app.raw, 'DemoView.render #23t129s111   ◀◀   DemoView.userFilter[=""] #23t127s111    ◀◀    T127[noname]')
    t.is(render.options.kind, Kind.Cached)
    t.is(render.error, undefined)
    t.is(Rx.getLoggingHint(app), 'DemoView')
    Rx.setLoggingHint(app, 'App')
    t.is(Rx.getLoggingHint(app, false), 'App')
    t.is(Rx.getLoggingHint(app, true), 'App#23')
    t.deepEqual(Object.getOwnPropertyNames(app.model), ['shared', 'title', 'users', 'collection1', 'collection2', 'usersWithoutLast'])
    t.deepEqual(Object.keys(app.model), ['shared', 'title', 'users', 'collection1', 'collection2', 'usersWithoutLast'])
    t.is(Object.getOwnPropertyDescriptors(app.model).title.writable, true)
    // Undo
    t.is(app.model.title, 'Demo')
    t.is(Demo.journal.edits.length, 1)
    // console.log(Demo.journal.unsaved.objects.values())
    app.model.testUndo()
    t.is(app.model.title, 'Demo - undo/redo')
    t.is(Demo.journal.edits.length, 2)
    // console.log(Demo.journal.unsaved.objects.values())
    Demo.journal.undo()
    t.is(app.model.title, 'Demo')
    t.is(Demo.journal.edits.length, 2)
    // console.log(Demo.journal.unsaved.objects.values())
    // Undo
    t.is(daddy.name, 'John Smith')
    t.is(daddy.age, 45)
    t.is(app.userFilter, '')
    Demo.journal.undo()
    t.is(daddy.name, 'John')
    t.is(daddy.age, 38)
    t.is(app.userFilter, 'Jo')
    Demo.journal.redo()
    t.is(daddy.name, 'John Smith')
    t.is(daddy.age, 45)
    t.is(app.userFilter, '')
    // Undo - decorator
    // op1undo.revert()
    // t.is(daddy.name, 'John Smith')
    // t.is(daddy.age, 45)
  }
  finally {
    Transaction.run(null, () => {
      Rx.dispose(app.model)
      Rx.dispose(app)
    })
    t.is(app.model.title as any, undefined)
    t.is(app.userFilter as any, undefined)
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (Rx.isLogging && Rx.loggingOptions.enabled) console.log(`actual[${i}] = \x1b[32m${output[i]}\x1b[0m,    expected[${i}] = \x1b[33m${expected[i]}\x1b[0m`)
    t.is(output[i], expected[i])
  }
})

/* istanbul ignore next */
export function nop(): void { /* do nothing */ }
