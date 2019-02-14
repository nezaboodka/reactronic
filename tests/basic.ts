import { state, stateless, transaction, cache, Renew } from "../src/z.index";
import { Person } from "./common";

export const actual: string[] = [];

@state
export class DemoModel {
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

@state
export class DemoView {
  @stateless readonly model: DemoModel;
  userFilter: string = "Jo";

  constructor(model: DemoModel) {
    this.model = model;
  }

  @cache(Renew.OnDemand)
  filteredUsers(): Person[] {
    const m = this.model;
    let result: Person[] = m.users;
    if (this.userFilter.length > 0) {
      result = [];
      for (let x of m.users)
        if (x.name && x.name.indexOf(this.userFilter) === 0)
          result.push(x);
    }
    return result;
  }

  @cache(Renew.OnDemand)
  render(): string[] {
    // Print only those users whos name starts with filter string
    let r: string[] = [];
    r.push(`Filter: ${this.userFilter}`);
    const a = this.filteredUsers();
    for (let x of a) {
      let childNames = x.children.map(child => child.name);
      r.push(`${x.name}'s children: ${childNames.join(", ")}`);
    }
    return r;
  }

  @cache(Renew.Immediately)
  print(): void {
    this.render().forEach(x => actual.push(x));
  }
}
