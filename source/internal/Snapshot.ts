// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg, misuse } from './Dbg';
import { Utils, undef } from './Utils';
import { Record, PropKey, ISnapshot, ICacheResult, RT_UNMOUNT } from './Record';
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
  static read = function(): Snapshot {
    return undef(); // to be redefined by Transaction implementation
  };

  /* istanbul ignore next */
  static write = function(): Snapshot {
    return undef(); // to be redefined by Transaction implementation
  };

  /* istanbul ignore next */
  static equal = function(oldValue: any, newValue: any): boolean {
    return oldValue === newValue; // to be redefined by Cache implementation
  };

  read(h: Handle): Record {
    const r = this.tryRead(h);
    if (r === Record.blank) /* istanbul ignore next */
      throw misuse(`object ${Hint.handle(h)} doesn't exist in snapshot v${this.timestamp}`);
    return r;
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

  write(h: Handle, prop: PropKey, value: any, token?: any): Record {
    let r: Record = this.tryRead(h);
    this.guard(h, r, prop, value, token);
    if (r.snapshot !== this) {
      const data = {...r.data};
      Reflect.set(data, RT_HANDLE, h);
      r = new Record(h.head, this, data);
      this.changeset.set(h, r);
      h.changing = r;
      h.writers++;
    }
    return r;
  }

  private guard(h: Handle, r: Record, prop: PropKey, value: any, token: any): void {
    if (this._applied)
      throw misuse(`stateful property ${Hint.handle(h, prop)} can only be modified inside transaction`);
    if (this.cache !== undefined && token !== this.cache && value !== RT_HANDLE)
      throw misuse(`cache must have no side effects (an attempt to change ${Hint.record(r, prop)})`);
    if (r === Record.blank && value !== RT_HANDLE) /* istanbul ignore next */
      throw misuse(`object ${Hint.record(r, prop)} doesn't exist in snapshot v${this.timestamp}`);
  }

  bumpBy(timestamp: number): void {
    if (timestamp > this._readstamp)
      this._readstamp = timestamp;
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
            if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(ours, prop)} ${equal ? "==" : "<>"} ${Hint.record(theirs, prop)}.`);
            if (!equal)
              ours.conflicts.set(prop, theirs);
            break;
          }
          else if (prop === RT_UNMOUNT || unmountTheirs) {
            if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(ours, prop)} <> ${Hint.record(theirs, prop)}.`);
            ours.conflicts.set(prop, theirs);
            break;
          }
          else {
            theirs = theirs.prev.record;
            if (Dbg.isOn && Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(ours, prop)} is taken from ours.`);
          }
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
      r.changes.forEach(prop => CopyOnWrite.seal(r.data[prop], h.proxy, prop));
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
          Dbg.log("║", "•", `${Hint.record(r)}(${s}) is applied over ${Hint.record(r.prev.record)}.`);
        }
      }
    });
    if (Dbg.isOn && Dbg.trace.transactions)
      Dbg.log(this.timestamp < UNDEFINED_TIMESTAMP ? "╚══" : /* istanbul ignore next */ "═══", `v${this.timestamp}`, `${this.hint} - ${error ? "CANCEL" : "COMMIT"}(${this.changeset.size})${error ? ` - ${error}` : ``}`);
    Snapshot.applyAllDependencies(this, error);
  }

  static applyAllDependencies = function(snapshot: Snapshot, error?: any): void {
    // to be redefined by Cache implementation
  };

  archive(): void {
    Snapshot.grabageCollection(this);
    Utils.freezeMap(this.changeset);
  }

  // static undo(s: Snapshot): void {
  //   s.changeset.forEach((r: Record, h: Handle) => {
  //     r.changes.forEach(prop => {
  //       if (r.prev.record !== Record.blank) {
  //         const prevValue: any = r.prev.record.data[prop];
  //         const ctx = Snapshot.write();
  //         const t: Record = ctx.write(h, prop, prevValue);
  //         if (t.snapshot === ctx) {
  //           t.data[prop] = prevValue;
  //           const v: any = t.prev.record.data[prop];
  //           Record.markChanged(t, prop, v !== prevValue, prevValue);
  //         }
  //       }
  //     });
  //   });
  // }

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
    if (Dbg.isOn && Dbg.trace.gc) Dbg.log("", "GC", `v${s.timestamp}t${s.id} (${s.hint}) snapshot is the oldest one now`);
    s.changeset.forEach((r: Record, h: Handle) => {
      if (Dbg.isOn && Dbg.trace.gc && r.prev.record !== Record.blank) Dbg.log("", " g", `v${s.timestamp}t${s.id}: ${Hint.record(r.prev.record)} is ready for GC because overwritten by ${Hint.record(r)}`);
      Record.archive(r.prev.record);
      // Snapshot.mergeObservers(r, r.prev.record);
      r.prev.record = Record.blank; // unlink history
    });
  }
}

export class Hint {
  static handle(h: Handle | undefined, prop?: PropKey | undefined, stamp?: number, tran?: number, typeless?: boolean): string {
    const obj = h === undefined
      ? "init"
      : (typeless
        ? (stamp === undefined ? `#${h.id}` : `#${h.id}v${stamp}t${tran}`)
        : (stamp === undefined ? `#${h.id}˙${h.hint}` : `#${h.id}v${stamp}t${tran}˙${h.hint}`));
    return prop !== undefined ? `${obj}.${prop.toString()}` : obj;
  }

  static record(r: Record, prop?: PropKey, typeless?: boolean): string {
    const h: Handle | undefined = Utils.get(r.data, RT_HANDLE);
    return Hint.handle(h, prop, r.snapshot.timestamp, r.snapshot.id, typeless);
  }

  static conflicts(conflicts: Record[]): string {
    return conflicts.map(ours => {
      const items: string[] = [];
      ours.conflicts.forEach((theirs: Record, prop: PropKey) => {
        items.push(Hint.conflictProp(prop, ours, theirs));
      });
      return items.join(", ");
    }).join(", ");
  }

  static conflictProp(prop: PropKey, ours: Record, theirs: Record): string {
    return Hint.record(theirs, prop);
  }
}
