// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.

// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { stateful, stateless, transaction, cache, behavior, Renew, trace } from '../src/reactronic';
import { Person } from './common';

export const output: string[] = [];

@stateful
export class DemoModel {
  @stateless shared: string = "for testing purposes";
  title: string = "Demo";
  users: Person[] = [];

  @transaction
  loadUsers(): void {
    this._loadUsers();
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
    }));
    this.users.push(new Person({
      name: "Kevin", age: 27,
      emails: ["kevin@mail.com"],
      children: [
        new Person({ name: "Britney" }),
      ],
    }));
  }
}

@trace({})
export class DemoView {
  shared: string = "for testing purposes";
  readonly model: DemoModel;
  @stateful userFilter: string = "Jo";

  constructor(model: DemoModel) {
    this.model = model;
  }

  @cache
  filteredUsers(): Person[] {
    const m = this.model;
    let result: Person[] = m.users;
    if (this.userFilter.length > 0) {
      result = [];
      for (const x of m.users)
        if (x.name && x.name.indexOf(this.userFilter) === 0)
          result.push(x);
    }
    return result;
  }

  @cache
  render(): string[] {
    // Print only those users whos name starts with filter string
    const r: string[] = [];
    r.push(`Filter: ${this.userFilter}`);
    const a = this.filteredUsers();
    for (const x of a) {
      const childNames = x.children.map(child => child.name);
      r.push(`${x.name}'s children: ${childNames.join(", ")}`);
    }
    return r;
  }

  @cache @behavior(Renew.Immediately)
  print(): void {
    this.render().forEach(x => output.push(x));
  }
}
