// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { stateful, stateless, transaction, trigger, cached, trace } from '../source/reactronic';
import { Person } from './common';

export const output: string[] = [];

// @stateful
// export class StatefulDemoModelBase {
//   @cached
//   methodOfStatefulBase(): string {
//     return 'methodOfStatefulBase';
//   }
// }

export class StatelessDemoModelBase {
  methodOfStatelessBase(): string {
    return 'methodOfStatelessBase';
  }
}

@stateful
export class DemoModel extends StatelessDemoModelBase {
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

@stateful @trace({})
export class DemoView {
  @stateless shared: string = "for testing purposes";
  @stateless readonly model: DemoModel;
  userFilter: string = "Jo";

  constructor(model: DemoModel) {
    this.model = model;
  }

  @trigger
  print(): void {
    this.render().forEach(x => output.push(x));
  }

  @transaction
  subprint(): void {
    this.render().forEach(x => output.push(x));
  }

  @cached
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

  @cached
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
}
