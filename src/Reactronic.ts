import { Cache, F, Handle } from "./internal/z.index";
import { Transaction } from "./Transaction";
import { Config } from "./Config";

export abstract class Reactronic<T> {
  abstract readonly config: Config;
  abstract configure(config: Partial<Config>): Config;
  abstract readonly interim: Promise<T> | T;
  abstract result(...args: any[]): T;
  abstract readonly error: any;
  abstract outdate(cause: string | undefined): boolean;
  abstract readonly isOutdated: boolean;
  abstract readonly isComputing: boolean;
  abstract readonly isUpdating: boolean;
  static at<T>(method: F<Promise<T>>): Reactronic<T>;
  static at<T>(method: F<T>): Reactronic<T> { return Cache.at(method); }
  static unmount(...objects: any[]): Transaction { return Cache.unmount(...objects); }
  static named<T extends object>(obj: T, name: string | undefined): T { return Handle.setName(obj, name); }
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
