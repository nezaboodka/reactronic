import { Utils } from "./Utils";
import { Record } from "./Record";

// Handle

export const RT_HANDLE: unique symbol = Symbol("RT:HANDLE");

export class Handle {
  private static id: number = 20;
  readonly stateless: any;
  readonly id: number;
  readonly type: string;
  readonly proxy: any;
  hint?: string;
  head: Record;
  editing?: Record;
  editors: number;

  constructor(stateless: any, proxy: any, hooks: ProxyHandler<Handle>) {
    this.stateless = stateless;
    this.id = ++Handle.id;
    this.type = stateless.constructor.name;
    this.proxy = proxy || new Proxy<Handle>(this, hooks);
    this.head = Record.blank();
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
