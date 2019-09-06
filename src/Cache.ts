import { CachedResult, F, Handle } from './internal/z.index';
import { Transaction } from './Transaction';
import { Config } from './Config';

export function resultof<T>(method: F<Promise<T>>, ...args: any[]): T | undefined {
  return (cacheof(method) as any).getResult(...args);
}

export function cacheof<T>(method: F<T>, ...args: any[]): Cache<T> {
  return Cache.get<T>(method);
}

export abstract class Cache<T> {
  abstract readonly config: Config;
  abstract configure(config: Partial<Config>): Config;
  abstract readonly stamp: number;
  abstract readonly error: any;
  abstract getResult(...args: any[]): T | undefined;
  abstract readonly isOutdated: boolean;
  abstract markOutdated(cause: string | undefined): boolean;
  static get<T>(method: F<T>): Cache<T> { return CachedResult.get(method); }
  static unmount(...objects: any[]): Transaction { return CachedResult.unmount(...objects); }
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Handle.setHint(obj, name); }
  static getTraceHint<T extends object>(obj: T): string | undefined { return Handle.getHint(obj); }
}
