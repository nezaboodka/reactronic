import { Log } from "./Log";

const RT_BINDING: unique symbol = Symbol("rt:binding");

export class Binding {
  constructor(
    readonly owner: any,
    readonly prop: PropertyKey,
    readonly array: any[]) {
  }

  readable(receiver: any): any[] {
    let a: any[] = this.owner[this.prop];
    if (a === receiver) // check if array is not yet cloned
      a = this.array;
    return a;
  }

  writable(receiver: any): any[] {
    let a: any[] = this.owner[this.prop];
    if (a === receiver) { // check if it's first write and clone then
      if (Log.verbosity >= 3) Log.print("║", "", ` Copy-on-write: ${this.owner.constructor.name}.${this.prop.toString()}(${a.length})`);
      a = this.owner[this.prop] = Array.prototype.slice.call(this.array);
    }
    return a;
  }
}

function R<T>(self: any): T[] {
  let binding: Binding = self[RT_BINDING];
  return binding.readable(self);
}

function W<T>(self: any): T[] {
  let binding: Binding = self[RT_BINDING];
  return binding.writable(self);
}

export class ArrayEx<T> extends Array<T> {
  static bind(owner: any, prop: PropertyKey, array: any[]): Binding {
    if (Object.isFrozen(this)) /* istanbul ignore next */
      throw new Error("E610: array cannot be referenced from multiple objects");
    let self: any = array;
    let binding = new Binding(owner, prop, array);
    self[RT_BINDING] = binding;
    Object.setPrototypeOf(array, ArrayEx.prototype);
    Object.freeze(array);
    return binding;
  }

  get length(): number { return R<T>(this).length; }
  toString(): string { return super.toString.call(R<T>(this)); }
  toLocaleString(): string { return super.toLocaleString.call(R<T>(this)); }
  pop(): T | undefined { return super.pop.call(W<T>(this)); }
  push(...items: T[]): number { return super.push.call(W<T>(this), ...items); }
  concat(...items: Array<ConcatArray<T>>): T[];
  concat(...items: Array<T | ConcatArray<T>>): T[] { return super.concat.call(R<T>(this), ...items); }
  join(separator?: string): string { return super.join.call(R<T>(this), separator); }
  reverse(): T[] { return super.reverse.call(R<T>(this)); }
  shift(): T | undefined { return super.shift.call(R<T>(this)); }
  slice(start?: number, end?: number): T[] { return super.slice.call(R<T>(this), start, end); }
  sort(compareFn?: (a: T, b: T) => number): this { super.sort.call(W<T>(this), compareFn); return this; }
  splice(start: number, deleteCount?: number): T[];
  splice(start: number, deleteCount: number, ...items: T[]): T[] { return super.splice.call(W<T>(this), start, deleteCount, ...items); }
  unshift(...items: T[]): number { return super.unshift.call(W<T>(this), ...items); }
  indexOf(searchElement: T, fromIndex?: number): number { return super.indexOf.call(R<T>(this), searchElement, fromIndex); }
  lastIndexOf(searchElement: T, fromIndex?: number): number { return super.lastIndexOf.call(R<T>(this), searchElement, fromIndex); }
  every(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean { return super.every.call(R<T>(this), callbackfn, thisArg); }
  some(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean { return super.some.call(R<T>(this), callbackfn, thisArg); }
  forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void { return super.forEach.call(R<T>(this), callbackfn, thisArg); }
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[] { return (super.map as any).call(R<T>(this), callbackfn, thisArg); }
  filter<S extends T>(callbackfn: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[];
  filter(callbackfn: (value: T, index: number, array: T[]) => any, thisArg?: any): T[] { return super.filter.call(R<T>(this), callbackfn, thisArg); }
  // reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue?: T): T;
  // reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U { return super.reduce.call(R<T>(this), callbackfn, initialValue); }
  // reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue?: T): T;
  // reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U { return super.reduceRight.call(R<T>(this), callbackfn, initialValue); }
}
