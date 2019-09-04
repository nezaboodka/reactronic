/* istanbul ignore file */

import { stateful } from "../src/z.index";

// Person

@stateful
export class Person {
  id: string | null = null;
  name: string | null = null;
  age: number = 0;
  emails: string[] | null = null;
  log: string[] = [];
  get parent(): Person | null { return this._parent; }
  set parent(value: Person | null) { this.setParent(value); }
  private _parent: Person | null = null;
  get children(): ReadonlyArray<Person> { return this._children; }
  set children(value: ReadonlyArray<Person>) { this.appendChildren(value); }
  private _children: Person[] = [];

  constructor(init?: Partial<Person>) {
    if (init)
      Object.assign(this, init);
  }

  setParent(value: Person | null): void {
    if (this.parent !== value) {
      if (this.parent) { // remove from children of old parent
        const a = this.parent._children;
        const i = a.findIndex((x, i) => x === this);
        if (i >= 0)
          a.splice(i, 1);
        else
          throw new Error("invariant is broken, please restart the application");
      }
      if (value) { // add to children of a new parent
        value._children.push(this);
        this._parent = value;
      }
      else
        this._parent = null;
    }
  }

  appendChildren(children: ReadonlyArray<Person>): void {
    if (children)
      for (const x of children)
        x.setParent(this);
  }
}
