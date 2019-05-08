import { Cache, F, Handle } from "./internal/z.index";
import { Transaction } from "./Transaction";
import { Config } from "./Config";

export abstract class ReactiveCache<T> {
  abstract readonly config: Config;
  abstract configure(config: Partial<Config>): Config;
  abstract readonly returnValue: Promise<T> | T;
  abstract readonly error: any;
  abstract result(...args: any[]): T;
  abstract invalidate(cause: string | undefined): boolean;
  abstract readonly isInvalidated: boolean;
  abstract readonly isComputing: boolean;
  abstract readonly isUpdating: boolean;
  static get<T>(method: F<Promise<T>>): ReactiveCache<T>;
  static get<T>(method: F<T>): ReactiveCache<T> { return Cache.get(method); }
  static unmount(...objects: any[]): Transaction { return Cache.unmount(...objects); }
  static named<T extends object>(obj: T, name: string | undefined): T { return Handle.setName(obj, name); }
}

// Function.reactiveCache

declare global {
  interface Function {
    readonly rcache: ReactiveCache<any>;
  }
}

Object.defineProperty(Function.prototype, "rcache", {
  get(): ReactiveCache<any> { return ReactiveCache.get(this); },
  configurable: false,
  enumerable: false,
});
