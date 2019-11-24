// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { State, stateless, action, trigger, cached, urgingArgs, Reactronic as R } from 'reactronic'

export const output: string[] = []

export class Demo extends State {
  @stateless shared: string = 'for testing purposes'
  title: string = 'Demo'
  users: Person[] = []
  usersWithoutLast: Person[] = []

  @action
  loadUsers(): void {
    this._loadUsers()
  }

  @trigger
  protected backup(): void {
    this.usersWithoutLast = this.users.slice()
    this.usersWithoutLast.pop()
  }

  private _loadUsers(): void {
    this.users.push(new Person({
      name: 'John', age: 38,
      emails: ['john@mail.com'],
      children: [
        new Person({ name: 'Billy' }), // William
        new Person({ name: 'Barry' }), // Barry
        new Person({ name: 'Steve' }), // Steven
      ],
    }))
    this.users.push(new Person({
      name: 'Kevin', age: 27,
      emails: ['kevin@mail.com'],
      children: [
        new Person({ name: 'Britney' }),
      ],
    }))
  }
}

export class DemoView extends State {
  @stateless shared: string = 'for testing purposes'
  @stateless readonly model: Demo
  userFilter: string = 'Jo'

  constructor(model: Demo) {
    super()
    this.model = model
  }

  @trigger
  print(): void {
    const lines = this.render(0)
    lines.forEach(x => {
      output.push(x) /* istanbul ignore next */
      if (R.isTraceOn && !R.trace.silent) console.log(x)
    })
  }

  // @action @trace(tracing.noisy)
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

  @cached @urgingArgs(true)
  render(counter: number): string[] {
    // Print only those users who's name starts with filter string
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
export class Person extends State {
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
    if (this.parent !== value) {
      if (this.parent) { // remove from children of old parent
        const a = this.parent._children
        const i = a.findIndex((x, i) => x === this)
        if (i >= 0)
          a.splice(i, 1)
        else
          throw new Error('invariant is broken, please restart the application')
      }
      if (value) { // add to children of a new parent
        value._children.push(this)
        this._parent = value
      }
      else
        this._parent = null
    }
  }

  appendChildren(children: ReadonlyArray<Person>): void {
    if (children)
      for (const x of children)
        x.setParent(this)
  }
}
