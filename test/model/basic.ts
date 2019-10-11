﻿// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Stateful, stateless, action, trigger, cached, cachedArgs, Tools as RT } from '../../source/.index'
import { Person } from './common'

export const output: string[] = []

export class Demo extends Stateful {
  @stateless shared: string = "for testing purposes"
  title: string = "Demo"
  users: Person[] = []

  @action
  loadUsers(): void {
    this._loadUsers()
  }

  @trigger
  normalizeTitle(): void {
    const stamp = new Date().toUTCString()
    const t = this.title.toLowerCase()
    this.title = `${t} - ${stamp}`
  }

  private _loadUsers(): void {
    this.users.push(new Person({
      name: "John", age: 38,
      emails: ["john@mail.com"],
      children: [
        new Person({ name: "Billy" }), // William
        new Person({ name: "Barry" }), // Barry
        new Person({ name: "Steve" }), // Steven
      ],
    }))
    this.users.push(new Person({
      name: "Kevin", age: 27,
      emails: ["kevin@mail.com"],
      children: [
        new Person({ name: "Britney" }),
      ],
    }))
  }
}

export class DemoView extends Stateful {
  @stateless shared: string = "for testing purposes"
  @stateless readonly model: Demo
  userFilter: string = "Jo"

  constructor(model: Demo) {
    super()
    this.model = model
  }

  @trigger
  print(): void {
    const lines = this.render(0)
    lines.forEach(x => {
      output.push(x) /* istanbul ignore next */
      if (RT.isTraceOn && !RT.trace.silent) console.log(x)
    })
  }

  // @action @trace(tracing.noisy)
  // subPrint(): void {
  //   this.render().forEach(x => output.push(x));
  // }

  @cached
  filteredUsers(): Person[] {
    const m = this.model
    let result: Person[] = m.users
    if (this.userFilter.length > 0) {
      result = []
      for (const x of m.users)
        if (x.name && x.name.indexOf(this.userFilter) === 0)
          result.push(x)
    }
    return result
  }

  @cached @cachedArgs(true)
  render(counter: number): string[] {
    // Print only those users who's name starts with filter string
    const r: string[] = []
    r.push(`Filter: ${this.userFilter}`)
    const a = this.filteredUsers()
    for (const x of a) {
      const childNames = x.children.map(child => child.name)
      r.push(`${x.name}'s children: ${childNames.join(", ")}`)
    }
    return r
  }

  static test(): void {
    // do nothing
  }
}