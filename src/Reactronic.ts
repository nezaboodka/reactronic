import { Utils, F, RT_CACHE, RT_DISMISSED } from "./internal/z.index";
import { Transaction } from "./Transaction";
import { Config } from "./Config";

export abstract class Reactronic<T> {
  abstract readonly config: Config;
  abstract configure(config: Partial<Config>): void;
  abstract readonly returned: Promise<T> | T;
  abstract readonly value: T;
  abstract readonly error: any;
  abstract readonly invalidator: string | undefined;
  abstract invalidate(invalidator: string | undefined): boolean;
  get isInvalidated(): boolean { return this.invalidator !== undefined; }

  static at<T>(method: F<Promise<T>>): Reactronic<T>;
  static at<T>(method: F<T>): Reactronic<T> {
    let impl: Reactronic<T> | undefined = Utils.get(method, RT_CACHE);
    if (!impl)
      throw new Error("given method is not a reaction");
    return impl;
  }

  static unmount(...objects: any[]): Transaction {
    let t: Transaction = Transaction.active;
    Transaction.runAs<void>("unmount", false, (): void => {
      t = Transaction.active;
      for (let x of objects)
        x[RT_DISMISSED] = RT_DISMISSED; // TODO: Check if object is an MVCC object
    });
    return t;
  }
}

// Function.reactronic

declare global {
  interface Function {
    readonly reactronic: Reactronic<any>;
  }
}

Object.defineProperty(Function.prototype, "reactronic", {
  get(): Reactronic<any> { return Reactronic.at(this); },
  configurable: false,
  enumerable: false,
});
