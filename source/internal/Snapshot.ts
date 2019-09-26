// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef } from './Utils';
import { Dbg } from './Dbg';
import { Record, ISnapshot, ICacheResult, RT_UNMOUNT } from './Record';
import { Handle, RT_HANDLE } from './Handle';
import { CopyOnWrite } from './Hooks';

const UNDEFINED_TIMESTAMP = Number.MAX_SAFE_INTEGER - 1;

// Snapshot

export class Snapshot implements ISnapshot {
  static lastUsedId: number = -1;
  static headTimestamp: number = 1;
  static pending: Snapshot[] = [];
  static oldest: Snapshot | undefined = undefined;

  readonly id: number;
  readonly hint: string;
  readonly cache: ICacheResult | undefined;
  get timestamp(): number { return this._timestamp; }
  get readstamp(): number { return this._readstamp; }
  get applied(): boolean { return this._applied; }
  readonly changeset: Map<Handle, Record>;
  readonly triggers: ICacheResult[];
  private _timestamp: number;
  private _readstamp: number;
  private _applied: boolean;

  constructor(hint: string, cache: ICacheResult | undefined) {
    this.id = ++Snapshot.lastUsedId;
    this.hint = hint;
    this.cache = cache;
    this.changeset = new Map<Handle, Record>();
    this.triggers = [];
    this._timestamp = UNDEFINED_TIMESTAMP;
    this._readstamp = 1;
    this._applied = false;
  }

  /* istanbul ignore next */
  static readable = function(): Snapshot {
    return undef(); // to be redefined by Transaction implementation
  };

  /* istanbul ignore next */
  static writable = function(): Snapshot {
    return undef(); // to be redefined by Transaction implementation
  };

  /* istanbul ignore next */
  static equal = function(oldValue: any, newValue: any): boolean {
    return oldValue === newValue; // to be redefined by Cache implementation
  };

  read(h: Handle): Record {
    const result = this.tryRead(h);
    if (result === Record.blank) /* istanbul ignore next */
      throw new Error(`object ${Hint.handle(h)} doesn't exist in snapshot v${this.timestamp}`);
    return result;
  }

  write(h: Handle, prop: PropertyKey, token: any): Record {
    const result: Record = this.tryWrite(h, prop, token);
    if (result === Record.blank) /* istanbul ignore next */
      throw new Error(`object ${Hint.handle(h)} doesn't exist in snapshot v${this.timestamp}`);
    return result;
  }

  tryRead(h: Handle): Record {
    let r: Record | undefined = h.changing;
    if (r && r.snapshot !== this) {
      r = this.changeset.get(h);
      if (r)
        h.changing = r; // remember last changing record
    }
    if (!r) {
      r = h.head;
      while (r !== Record.blank && r.snapshot.timestamp > this.timestamp)
        r = r.prev.record;
    }
    return r;
  }

  tryWrite(h: Handle, prop: PropertyKey, token: any): Record {
    if (this._applied)
      throw new Error(`stateful property ${Hint.handle(h)}.${prop.toString()} can only be modified inside transaction`);
    if (this.cache !== undefined && token !== this.cache && token !== RT_HANDLE)
      throw new Error(`cache must have no side effects (an attempt to change ${Hint.handle(h)}.${prop.toString()})`);
    let r: Record = this.tryRead(h);
    if (r === Record.blank || r.data[prop] !== token) {
      if (r.snapshot !== this) {
        const data = Utils.copyAllProps(r.data, {});
        r = new Record(h.head, this, data);
        Reflect.set(r.data, RT_HANDLE, h);
        this.changeset.set(h, r);
        h.changing = r;
        h.writers++;
      }
    }
    else
      r = Record.blank; // ignore if property is set to the same value
    return r;
  }

  bumpReadStamp(r: Record): void {
    if (r.snapshot.timestamp > this._readstamp)
      this._readstamp = r.snapshot.timestamp;
  }

  acquire(outer: Snapshot): void {
    if (!this._applied && this._timestamp === UNDEFINED_TIMESTAMP) {
      this._timestamp = this.cache === undefined || outer._timestamp === UNDEFINED_TIMESTAMP
        ? Snapshot.headTimestamp : outer._timestamp;
      Snapshot.pending.push(this);
      if (Snapshot.oldest === undefined)
        Snapshot.oldest = this;
      if (Dbg.isOn && Dbg.trace.transactions) Dbg.log("╔══", `v${this.timestamp}`, `${this.hint}`);
    }
  }

  rebase(): Record[] | undefined { // return conflicts
    let conflicts: Record[] | undefined = undefined;
    if (this.changeset.size > 0) {
      this.changeset.forEach((r: Record, h: Handle) => {
        const merged = Snapshot.rebaseRecord(r, h.head);
        if (merged >= 0) {
          if (r.conflicts.size > 0) {
            if (!conflicts)
              conflicts = [];
            conflicts.push(r);
          }
          if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(r)} is merged with ${Hint.record(h.head)} among ${merged} properties with ${r.conflicts.size} conflicts.`);
        }
      });
      if (this.cache === undefined) {
        this._readstamp = this._timestamp;
        this._timestamp = ++Snapshot.headTimestamp;
      }
      else
        this._timestamp = this._readstamp; // downgrade timestamp of renewed cache
    }
    return conflicts;
  }

  static rebaseRecord(ours: Record, head: Record): number {
    let counter: number = -1;
    if (ours.prev.record !== head && head !== Record.blank) {
      counter++;
      const unmountTheirs: boolean = head.changes.has(RT_UNMOUNT);
      const merged = Utils.copyAllProps(head.data, {}); // create merged copy
      ours.changes.forEach(prop => {
        counter++;
        let theirs: Record = head;
        merged[prop] = ours.data[prop];
        while (theirs !== ours.prev.record && theirs !== Record.blank) {
          if (theirs.changes.has(prop)) {
            const equal = Snapshot.equal(theirs.data[prop], ours.data[prop]);
            if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(ours)}.${prop.toString()} ${equal ? "==" : "<>"} ${Hint.record(theirs)}.${prop.toString()}.`);
            if (!equal)
              ours.conflicts.set(prop, theirs);
            break;
          }
          else if (prop === RT_UNMOUNT || unmountTheirs) {
            if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(ours)}.${prop.toString()} "<>" ${Hint.record(theirs)}.${prop.toString()}.`);
            ours.conflicts.set(prop, theirs);
            break;
          }
          else
            theirs = theirs.prev.record;
        }
      });
      Utils.copyAllProps(merged, ours.data); // overwrite with merged copy
      ours.prev.record = head; // rebased
    }
    return counter;
  }

  apply(error?: any): void {
    this._applied = true;
    this.changeset.forEach((r: Record, h: Handle) => {
      r.changes.forEach(prop => CopyOnWrite.seal(r.data, h.proxy, prop));
      r.freeze();
      h.writers--;
      if (h.writers === 0)
        h.changing = undefined;
      if (!error) {
        h.head = r;
        if (Dbg.isOn && Dbg.trace.changes) {
          const props: string[] = [];
          r.changes.forEach(prop => props.push(prop.toString()));
          const s = props.join(", ");
          Dbg.log("║", "•", r.prev.record !== Record.blank ? `${Hint.record(r.prev.record)}(${s}) is overwritten.` : `${Hint.record(r)}(${s}) is created.`);
        }
      }
    });
    if (Dbg.isOn && Dbg.trace.transactions)
      Dbg.log(this.timestamp < UNDEFINED_TIMESTAMP ? "╚══" : /* istanbul ignore next */ "═══", `v${this.timestamp}`, `${this.hint} - ${error ? "CANCEL" : "COMMIT"}(${this.changeset.size})${error ? ` - ${error}` : ``}`);
    Snapshot.applyDependencies(this, error);
  }

  static applyDependencies = function(snapshot: Snapshot, error?: any): void {
    // to be redefined by Cache implementation
  };

  archive(): void {
    Snapshot.grabageCollection(this);
    Utils.freezeMap(this.changeset);
  }

  static undo(s: Snapshot): void {
    s.changeset.forEach((r: Record, h: Handle) => {
      r.changes.forEach(prop => {
        if (r.prev.backup) {
          const prevValue: any = r.prev.backup.data[prop];
          const t: Record = Snapshot.writable().tryWrite(h, prop, prevValue);
          if (t !== Record.blank) {
            t.data[prop] = prevValue;
            const v: any = t.prev.record.data[prop];
            Record.markChanged(t, prop, v !== prevValue, prevValue);
          }
        }
      });
    });
  }

  private static grabageCollection(s: Snapshot): void {
    if (s.timestamp !== 0) {
      if (s === Snapshot.oldest) {
        const p = Snapshot.pending;
        p.sort((a, b) => a._timestamp - b._timestamp);
        let i: number = 0;
        while (i < p.length && p[i]._applied) {
          Snapshot.unlinkHistory(p[i]);
          i++;
        }
        Snapshot.pending = p.slice(i);
        Snapshot.oldest = Snapshot.pending[0]; // undefined is OK
      }
    }
  }

  private static unlinkHistory(s: Snapshot): void {
    if (Dbg.isOn && Dbg.trace.gc) Dbg.log("", " g", `snapshot of T${s.id} (${s.hint}) is being collected`);
    s.changeset.forEach((r: Record, h: Handle) => {
      if (Dbg.isOn && Dbg.trace.gc && r.prev.record !== Record.blank) Dbg.log("", " ·", `${Hint.record(r.prev.record)} is ready for GC (overwritten by ${Hint.record(r)}}`);
      Record.archive(r.prev.record);
      // Snapshot.mergeObservers(r, r.prev.record);
      r.prev.record = Record.blank; // unlink history
    });
  }
}

export class Hint {
  static handle(h: Handle, stamp?: number, nameless?: boolean): string {
    return nameless
      ? (stamp === undefined ? `#${h.id}` : `#${h.id}v${stamp}`)
      : (stamp === undefined ? `#${h.id}˙${h.hint}` : `#${h.id}v${stamp}˙${h.hint}`);
  }

  static record(r: Record, nameless?: boolean, prop?: PropertyKey): string {
    const h: Handle | undefined = Utils.get(r.data, RT_HANDLE);
    const name: string = h ? Hint.handle(h, r.snapshot.timestamp, nameless) : /* istanbul ignore next */ "blank";
    return prop !== undefined ? `${name}.${prop.toString()}` : `${name}`;
  }

  static conflicts(conflicts: Record[]): string {
    return conflicts.map(ours => {
      const items: string[] = [];
      ours.conflicts.forEach((theirs: Record, prop: PropertyKey) => {
        items.push(Hint.conflictProp(prop, ours, theirs));
      });
      return items.join(", ");
    }).join(", ");
  }

  static conflictProp(prop: PropertyKey, ours: Record, theirs: Record): string {
    return Hint.record(theirs, false, prop);
  }
}
