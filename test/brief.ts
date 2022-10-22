// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { ObservableObject, raw, transactional, reactive, cached, Journal, Rx, LoggingOptions, Transaction, options } from '../source/api'

export const output: string[] = []

export class Demo extends ObservableObject {
  static stamp = 0
  static journal = Transaction.run(null, () => Journal.create())

  @cached
  get computed(): string { return `${this.title}.computed @ ${++Demo.stamp}` }
  // set computed(value: string) { /* nop */ }

  @raw shared: string = 'for testing purposes'
  title: string = 'Demo'
  users: Person[] = []
  collection1: Person[] = this.users
  collection2: Person[] = this.users
  usersWithoutLast: Person[] = this.users

  @transactional
  loadUsers(): void {
    this._loadUsers()
  }

  @transactional
  testCollectionSealing(): void {
    this.collection1 = this.collection2 = []
  }

  @transactional
  testImmutableCollection(): void {
    this.collection1.push(...this.users)
  }

  @transactional @options({ journal: Demo.journal })
  testUndo(): void {
    this.title = 'Demo - undo/redo'
  }

  @reactive @options({ order: 1 })
  protected backup(): void {
    this.usersWithoutLast = this.users.slice()
    this.usersWithoutLast.pop()
  }

  private _loadUsers(): void {
    const users = this.users = this.users.toMutable()
    users.push(new Person({
      name: 'John', age: 38,
      emails: ['john@mail.com'],
      children: [
        new Person({ name: 'Billy' }), // William
        new Person({ name: 'Barry' }), // Barry
        new Person({ name: 'Steve' }), // Steven
      ],
    }))
    users.push(new Person({
      name: 'Kevin', age: 27,
      emails: ['kevin@mail.com'],
      children: [
        new Person({ name: 'Britney' }),
      ],
    }))
  }
}

export class DemoView extends ObservableObject {
  @raw raw: string = 'plain field'
  @raw shared: string = 'for testing purposes'
  @raw readonly model: Demo
  userFilter: string = 'Jo'

  constructor(model: Demo) {
    super()
    this.model = model
    // R.configureObject(this, { sensitivity: Sensitivity.ReactOnFinalDifferenceOnly })
  }

  @reactive
  print(): void {
    const lines = this.render(0)
    lines.forEach(x => {
      output.push(x) /* istanbul ignore next */
      if (Rx.isLogging && Rx.loggingOptions.enabled) console.log(x)
    })
    Rx.configureCurrentOperation({ order: 123 })
  }

  // @transaction @options({ logging: LoggingLevel.Debug })
  // subPrint(): void {
  //   this.render().forEach(x => output.push(x));
  // }

  @cached
  filteredUsers(): Person[] {
    const m = this.model
    let result: Person[] = m.users.slice()
    if (this.userFilter.length > 0) {
      result = []
      for (const x of m.users)
        if (x.name && x.name.indexOf(this.userFilter) === 0)
          result.push(x)
    }
    return result
  }

  @cached @options({ triggeringArgs: true })
  render(counter: number): string[] {
    // Print only those users who's name starts with filter string
    this.raw = Rx.why(true)
    const r: string[] = []
    r.push(`Filter: ${this.userFilter}`)
    const a = this.filteredUsers()
    for (const x of a) {
      const childNames = x.children.map(child => child.name)
      r.push(`${x.name}'s children: ${childNames.join(', ')}`)
    }
    return r
  }

  static test(): void {
    // do nothing
  }
}

// Person

/* istanbul ignore next */
export class Person extends ObservableObject {
  @raw dummy: string | null = null
  id: string | null = null
  name: string | null = null
  age: number = 0
  emails: string[] | null = null
  attributes: Map<string, any> = new Map<string, any>()
  get parent(): Person | null { return this._parent } /* istanbul ignore next */
  set parent(value: Person | null) { this.setParent(value) }
  private _parent: Person | null = null
  get children(): ReadonlyArray<Person> { return this._children }
  set children(value: ReadonlyArray<Person>) { this.appendChildren(value) }
  private _children: Person[] = []

  constructor(init?: Partial<Person>) {
    super()
    if (init)
      Object.assign(this, init)
  }

  /* istanbul ignore next */
  setParent(value: Person | null): void {
    if (this._parent !== value) {
      if (this._parent) { // remove from children of old parent
        const children = this._parent._children = this._parent._children.toMutable()
        const i = children.findIndex((x, i) => x === this)
        if (i >= 0)
          children.splice(i, 1)
        else
          throw new Error('invariant is broken, please restart the application')
      }
      if (value) { // add to children of a new parent
        const children = value._children = value._children.toMutable()
        children.push(this)
        this._parent = value
      }
      else
        this._parent = null
    }
  }

  appendChildren(children: ReadonlyArray<Person> | undefined): void {
    if (children)
      for (const x of children)
        x.setParent(this)
  }
}

export const TestsLoggingLevel: LoggingOptions = {
  enabled: process.env.AVA_DEBUG !== undefined,
  transaction: true,
  operation: true,
  step: true,
  monitor: true,
  read: true,
  write: true,
  change: true,
  obsolete: true,
  error: true,
  warning: true,
  gc: true,
  color: 37,
  prefix: '',
  margin1: 0,
  margin2: 0,
}
