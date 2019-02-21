import { Cache, F } from "./internal/z.index";
import { Transaction } from "./Transaction";
import { Config } from "./Config";

export abstract class Reactronic<T> {
  abstract readonly config: Config;
  abstract configure(config: Partial<Config>): Config;
  abstract readonly returned: Promise<T> | T;
  abstract readonly value: T;
  abstract readonly error: any;
  abstract readonly pulsar: any;
  abstract readonly invalidator: string | undefined;
  abstract invalidate(invalidator: string | undefined): boolean;
  get isInvalidated(): boolean { return this.invalidator !== undefined; }
  abstract readonly isRunning: boolean;
  static at<T>(method: F<Promise<T>>): Reactronic<T>;
  static at<T>(method: F<T>): Reactronic<T> { return Cache.at(method); }
  static unmount(...objects: any[]): Transaction { return Cache.unmount(...objects); }
  static pulse(data: any): void { Cache.pulse(data); }
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
