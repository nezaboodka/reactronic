// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.

// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { stateful, Trace } from '../src/reactronic';

// Person

@stateful
export class Person {
  id: string | null = null;
  name: string | null = null;
  age: number = 0;
  emails: string[] | null = null;
  attributes: Map<string, any> = new Map<string, any>();
  get parent(): Person | null { return this._parent; } /* istanbul ignore next */
  set parent(value: Person | null) { this.setParent(value); }
  private _parent: Person | null = null;
  get children(): ReadonlyArray<Person> { return this._children; }
  set children(value: ReadonlyArray<Person>) { this.appendChildren(value); }
  private _children: Person[] = [];

  constructor(init?: Partial<Person>) {
    if (init)
      Object.assign(this, init);
  }

  /* istanbul ignore next */
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

export const trace: Trace = {
  silent: process.env.AVA_DEBUG === undefined,
  hints: true,
  transactions: true,
  methods: true,
  monitors: true,
  reads: true,
  writes: true,
  changes: true,
  subscriptions: true,
  invalidations: true,
  gc: true,
};

/* istanbul ignore next */
export function nop(): void { /* do nothing */ }
