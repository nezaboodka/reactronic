// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils } from './Utils';
import { Record } from './Record';

// Handle

export const R_HANDLE: unique symbol = Symbol("R:HANDLE");

export class Handle {
  private static id: number = 20;
  readonly stateless: any;
  readonly id: number;
  readonly proxy: any;
  hint: string;
  head: Record;
  changing?: Record;
  writers: number;

  constructor(stateless: any, proxy: any, hint: string, handler: ProxyHandler<Handle>) {
    this.stateless = stateless;
    this.id = ++Handle.id;
    this.proxy = proxy || new Proxy<Handle>(this, handler);
    this.hint = hint;
    this.head = Record.blank;
    this.changing = undefined;
    this.writers = 0;
  }

  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const h: Handle = Utils.get(obj, R_HANDLE);
      if (h)
        h.hint = hint;
    }
    return obj;
  }

  static getHint(obj: object): string | undefined {
    const h: Handle = Utils.get(obj, R_HANDLE);
    return h ? h.hint : undefined;
  }
}
