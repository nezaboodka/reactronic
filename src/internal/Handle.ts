import { Utils } from "./Utils";
import { Record } from "./Record";

// Handle

export const RT_HANDLE: unique symbol = Symbol("RT:HANDLE");

export class Handle {
  private static id: number = 20;
  readonly stateless: any;
  readonly id: number;
  readonly proxy: any;
  hint: string;
  head: Record;
  editing?: Record;
  editors: number;

  constructor(stateless: any, proxy: any, virtualization: ProxyHandler<Handle>) {
    this.stateless = stateless;
    this.id = ++Handle.id;
    this.proxy = proxy || new Proxy<Handle>(this, virtualization);
    this.hint = stateless.constructor.name;
    this.head = Record.empty;
    this.editing = undefined;
    this.editors = 0;
  }

  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const h: Handle = Utils.get(obj, RT_HANDLE);
      if (h)
        h.hint = hint;
    }
    return obj;
  }

  static getHint(obj: object): string | undefined {
    const h: Handle = Utils.get(obj, RT_HANDLE);
    return h ? h.hint : undefined;
  }
}
