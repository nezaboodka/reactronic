import { Binding, R, W } from "./Binding";
export { Binding } from "./Binding";

export class CopyOnWriteSet<T> extends Set<T> {
  add(value: T): this { W<Set<T>>(this).add(value); return this; }
  clear(): void { return W<Set<T>>(this).clear(); }
  delete(value: T): boolean { return W<Set<T>>(this).delete(value); }
  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void { R<Set<T>>(this).forEach(callbackfn, thisArg); }
  has(value: T): boolean { return R<Set<T>>(this).has(value); }
  get size(): number { return R<Set<T>>(this).size; }

  static seal<T>(owner: any, prop: PropertyKey, set: Set<T>): Binding<Set<T>> {
    return Binding.seal(owner, prop, set, CopyOnWriteSet.prototype, CopyOnWriteSet.clone);
  }

  static clone<T>(set: Set<T>): Set<T> {
    return new Set<T>(set);
  }
}
