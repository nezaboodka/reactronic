import { Debug } from "./Debug";

export const RT_BINDING: unique symbol = Symbol("rt:binding");

export class Binding<T> {
  constructor(
    readonly owner: any,
    readonly prop: PropertyKey,
    readonly value: T,
    readonly clone: (value: T) => T) {
  }

  readable(receiver: any): T {
    let v: T = this.owner[this.prop];
    if (v === receiver) // check if array is not yet cloned
      v = this.value;
    return v;
  }

  writable(receiver: any): T {
    let v: T = this.owner[this.prop];
    if (v === receiver) { // check if it's first write and clone then
      if (Debug.verbosity >= 5) Debug.log("║", "", ` Copy-on-write: ${this.owner.constructor.name}.${this.prop.toString()}`);
      v = this.owner[this.prop] = this.clone(this.value);
    }
    return v;
  }

  static seal<T>(owner: any, prop: PropertyKey, value: T, proto: object, clone: (v: T) => T): Binding<T> {
    if (Object.isFrozen(value)) /* istanbul ignore next */
      throw new Error("E610: copy-on-write collection cannot be referenced from multiple objects");
    let self: any = value;
    let binding = new Binding<T>(owner, prop, value, clone);
    self[RT_BINDING] = binding;
    Object.setPrototypeOf(value, proto);
    Object.freeze(value);
    return binding;
  }
}

export function R<T>(self: any): T {
  let binding: Binding<T> = self[RT_BINDING];
  return binding !== undefined ? binding.readable(self) : self;
}

export function W<T>(self: any): T {
  let binding: Binding<T> = self[RT_BINDING];
  return binding !== undefined ? binding.writable(self) : self;
}
