import { Utils, undef } from "./Utils";

export const RT_UNMOUNT: unique symbol = Symbol("RT:UNMOUNT");

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

  static blank = function(): Record {
    return undef(); // to be redefined by Transaction implementation
  };

  static markEdited = function(r: Record, prop: PropertyKey, edited: boolean, value: any): void {
    return undef(); // to be redefined by Cache implementation
  };

  static markViewed = function(r: Record, prop: PropertyKey): void {
    return undef(); // to be redefined by Cache implementation
  };

  freeze<T, C>(): void {
    Object.freeze(this.data);
    Utils.freezeSet(this.edits);
    Utils.freezeMap(this.conflicts);
    Object.freeze(this);
  }

  static archive<T, C>(r: Record | undefined): void {
    if (r) {
      // Utils.freezeSet(r.overwritten);
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
  readonly completed: boolean;
}

export interface ICache {
  wrap<T>(func: F<T>): F<T>;
  invalidateBy(cause: string, hot: boolean, cascade: boolean, effect: ICache[]): void;
  ensureUpToDate(now: boolean, ...args: any[]): void;
}
