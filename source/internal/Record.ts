// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef } from './Utils';

export const RT_UNMOUNT: unique symbol = Symbol("RT:UNMOUNT");

// Record

export class Record {
  readonly prev: { record: Record, backup?: Record };
  readonly snapshot: ISnapshot;
  readonly data: any;
  readonly changes: Set<PropertyKey>;
  readonly conflicts: Map<PropertyKey, Record>;
  readonly observers: Map<PropertyKey, Set<ICacheResult>>;
  readonly replaced: Map<PropertyKey, Record>;

  constructor(prev: Record, snapshot: ISnapshot, data: object) {
    this.prev = { record: prev, backup: prev };
    this.snapshot = snapshot;
    this.data = data;
    this.changes = new Set<PropertyKey>();
    this.conflicts = new Map<PropertyKey, Record>();
    this.observers = new Map<PropertyKey, Set<ICacheResult>>();
    this.replaced = new Map<PropertyKey, Record>();
  }

  static blank: Record;

  /* istanbul ignore next */
  static markChanged = function(r: Record, prop: PropertyKey, changed: boolean, value: any): void {
     return undef(); // to be redefined by Cache implementation
  };

  /* istanbul ignore next */
  static markViewed = function(r: Record, prop: PropertyKey): void {
    return undef(); // to be redefined by Cache implementation
  };

  freeze<T, C>(): void {
    Object.freeze(this.data);
    Utils.freezeSet(this.changes);
    Utils.freezeMap(this.conflicts);
    Object.freeze(this);
  }

  static archive<T, C>(r: Record): void {
    if (r !== Record.blank) {
      // Utils.freezeSet(r.outdated);
      // Utils.freezeMap(r.observers);
    }
  }
}

// Dependencies (abstract)

export type F<T> = (...args: any[]) => T;

export interface ISnapshot {
  readonly id: number;
  readonly hint: string;
  readonly timestamp: number;
  readonly viewstamp: number;
  readonly sealed: boolean;
}

export interface ICacheResult {
  hint(tranless?: boolean): string;
  wrap<T>(func: F<T>): F<T>;
  readonly invalidated: { since: number };
  invalidateBy(since: number, cause: Record, causeProp: PropertyKey, triggers: ICacheResult[]): void;
  renew(timestamp: number, now: boolean, nothrow: boolean): void;
}
