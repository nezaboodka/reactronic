import { Utils } from "./Utils";
import { Record } from "./Record";

// Handle

export const RT_HANDLE: unique symbol = Symbol("RT:HANDLE");

export class Handle {
  private static id: number = 20;
  readonly stateless: any;
  readonly id: number;
  readonly proxy: any;
  name: string;
  head: Record;
  editing?: Record;
  editors: number;

  constructor(stateless: any, proxy: any, hooks: ProxyHandler<Handle>) {
    this.stateless = stateless;
    this.id = ++Handle.id;
    this.proxy = proxy || new Proxy<Handle>(this, hooks);
    this.name = stateless.constructor.name;
    this.head = Record.blank();
    this.editing = undefined;
    this.editors = 0;
  }

  static setName(obj: object, name: string | undefined): void {
    let h: Handle = Utils.get(obj, RT_HANDLE);
    if (h && name)
      h.name = name;
  }

  static getName(obj: object): string | undefined {
    let h: Handle = Utils.get(obj, RT_HANDLE);
    return h ? h.name : undefined;
  }
}
