import { Utils } from "./Utils";
import { Record } from "./Record";

// Handle

export const RT_HANDLE: unique symbol = Symbol("RT:HANDLE");

export class Handle {
  private static id: number = 20;
  readonly id: number;
  readonly type: string;
  readonly proxy: any;
  readonly proto: any;
  readonly stateless: any;
  hint?: string;
  head: Record;
  editing?: Record;
  editors: number;

  constructor(proxy: any, hooks: ProxyHandler<Handle>, head: Record, self: any) {
    this.id = ++Handle.id;
    this.type = self.constructor.name;
    this.proxy = proxy || new Proxy<Handle>(this, hooks);
    this.proto = Object.getPrototypeOf(self);
    this.stateless = {};
    this.head = head;
    this.editing = undefined;
    this.editors = 0;
  }

  static setHint(obj: object, hint: string | undefined): void {
    let h: Handle = Utils.get(obj, RT_HANDLE);
    if (h)
      h.hint = hint;
  }

  static getHint(obj: object): string | undefined {
    let h: Handle = Utils.get(obj, RT_HANDLE);
    return h ? h.hint : undefined;
  }
}
