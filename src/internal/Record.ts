import { Utils, undef } from './Utils';

export const RT_UNMOUNT: unique symbol = Symbol("RT:UNMOUNT");

// Record

export class Record {
  readonly prev: { record: Record, backup?: Record };
  readonly snapshot: ISnapshot;
  readonly data: any;
  readonly changes: Set<PropertyKey>;
  readonly conflicts: Map<PropertyKey, Record>;
  readonly observers: Map<PropertyKey, Set<ICachedResult>>;
  readonly outdated: Map<PropertyKey, Record>;

  constructor(prev: Record, snapshot: ISnapshot, data: object) {
    this.prev = { record: prev, backup: prev };
    this.snapshot = snapshot;
    this.data = data;
    this.changes = new Set<PropertyKey>();
    this.conflicts = new Map<PropertyKey, Record>();
    this.observers = new Map<PropertyKey, Set<ICachedResult>>();
    this.outdated = new Map<PropertyKey, Record>();
  }

  static blank: Record;

  static markChanged = function(r: Record, prop: PropertyKey, changed: boolean, value: any): void {
    /* istanbul ignore next */ return undef(); // to be redefined by Cache implementation
  };

  static markViewed = function(r: Record, prop: PropertyKey): void {
    /* istanbul ignore next */ return undef(); // to be redefined by Cache implementation
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
  readonly completed: boolean;
}

export interface ICachedResult {
  hint(tranless?: boolean): string;
  wrap<T>(func: F<T>): F<T>;
  readonly isInvalid: boolean;
  invalidate(cause: Record, causeProp: PropertyKey, cascade: boolean, effect: ICachedResult[]): void;
  triggerRecache(timestamp: number, now: boolean): void;
}
