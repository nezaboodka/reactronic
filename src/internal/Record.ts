import { Utils, undef } from "./Utils";
import { ArrayHooks } from "./Hooks";

export const RT_DISMISSED: unique symbol = Symbol("RT:DISMISSED");

// Record

export class Record {
  readonly prev: { record?: Record, backup?: Record };
  readonly snapshot: ISnapshot;
  readonly data: any;
  readonly edits: Set<PropertyKey>;
  readonly conflicts: Map<PropertyKey, Record>;
  readonly observers: Map<PropertyKey, Set<ICache>>;
  readonly overwritten: Set<PropertyKey>;

  constructor(prev: Record | undefined, snapshot: ISnapshot, data: object) {
    this.prev = { record: prev, backup: prev };
    this.snapshot = snapshot;
    this.data = data;
    this.edits = new Set<PropertyKey>();
    this.conflicts = new Map<PropertyKey, Record>();
    this.observers = new Map<PropertyKey, Set<ICache>>();
    this.overwritten = new Set<PropertyKey>();
  }

  static markEdited = function(r: Record, prop: PropertyKey, edited: boolean): void {
    edited ? r.edits.add(prop) : r.edits.delete(prop);
  };

  static markViewed = function(r: Record, prop: PropertyKey): void {
    undef(); // to be redefined by Cache implementation
  };

  finalize<T, C>(proxy: any): void {
    this.edits.forEach((prop: PropertyKey) => {
      let arr = this.data[prop];
      if (Array.isArray(arr) && !Object.isFrozen(arr))
        this.data[prop] = ArrayHooks.freezeAndWrapArray(proxy, prop, arr);
    });
    Object.freeze(this.data);
    Utils.freezeSet(this.edits);
    Utils.freezeMap(this.conflicts);
    Object.freeze(this);
  }

  static archive<T, C>(r: Record | undefined): void {
    // TODO: Utils.freezeSet(r.overwritten);
    if (r)
      Utils.freezeMap(r.observers);
  }
}

// Dependecies (abstract)

export type F<T> = (...args: any[]) => T;

export interface ISnapshot {
  readonly id: number;
  readonly hint: string;
  readonly timestamp: number;
  readonly completed: boolean;
}

export interface ICache {
  wrap<T>(func: F<T>): F<T>;
  invalidate(invalidator: string, effect: ICache[]): void;
  ensureUpToDate(now: boolean, ...args: any[]): void;
}
