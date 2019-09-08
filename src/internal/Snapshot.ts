import { Utils, undef } from './Utils';
import { Dbg } from './Dbg';
import { Record, ISnapshot, ICachedResult, RT_UNMOUNT } from './Record';
import { Handle, RT_HANDLE } from './Handle';
import { CopyOnWrite } from './Hooks';

const MAX_TIMESTAMP = Number.MAX_SAFE_INTEGER - 1;

// Snapshot

export class Snapshot implements ISnapshot {
  static lastUsedId: number = 20;
  static headTimestamp: number = 100;
  static pending: Snapshot[] = [];
  static oldest: Snapshot | undefined = undefined;

  readonly id: number = 0;
  readonly hint: string = "";
  get timestamp(): number { return this._timestamp; }
  get completed(): boolean { return this._completed; }
  readonly changeset: Map<Handle, Record> = new Map<Handle, Record>();
  private _timestamp = MAX_TIMESTAMP;
  private _completed = false;

  constructor(hint: string) {
    this.id = ++Snapshot.lastUsedId;
    this.hint = hint;
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
  static same = function(oldValue: any, newValue: any): boolean {
    return oldValue === newValue; // to be redefined by Cache implementation
  };

  read(h: Handle): Record {
    const result = this.tryRead(h);
    if (result === Record.blank) /* istanbul ignore next */
      throw new Error(`object being accessed doesn't exist in snapshot v${this.timestamp}`);
    return result;
  }

  write(h: Handle, prop: PropertyKey, value: Symbol): Record {
    const result: Record = this.tryWrite(h, prop, value);
    if (result === Record.blank) /* istanbul ignore next */
      throw new Error(`object being changed doesn't exist in snapshot v${this.timestamp}`);
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

  tryWrite(h: Handle, prop: PropertyKey, value: any): Record {
    if (this.completed)
      throw new Error(`stateful property ${Hint.handle(h)}.${prop.toString()} can only be modified inside transaction`);
    let r: Record = this.tryRead(h);
    if (r === Record.blank || r.data[prop] !== value) {
      if (r === Record.blank || r.snapshot !== this) {
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

  acquire(): void {
    if (!this.completed && this.timestamp === MAX_TIMESTAMP) {
      this._timestamp = Snapshot.headTimestamp;
      Snapshot.pending.push(this);
      if (Snapshot.oldest === undefined)
        Snapshot.oldest = this;
      if (Dbg.trace.transactions) Dbg.log("╔══", `v${this.timestamp}`, `${this.hint}`);
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
          if (Dbg.trace.writes) Dbg.log("║", "Y", `${Hint.record(r, true)} is merged with ${Hint.record(h.head, false)} among ${merged} properties with ${r.conflicts.size} conflicts.`);
        }
      });
      this._timestamp = ++Snapshot.headTimestamp;
    }
    return conflicts;
  }

  static rebaseRecord(ours: Record, head: Record): number {
    let counter: number = -1;
    if (head !== Record.blank && head.snapshot.timestamp > ours.snapshot.timestamp) {
      counter++;
      const unmountTheirs: boolean = head.changes.has(RT_UNMOUNT);
      const merged = Utils.copyAllProps(head.data, {}); // create merged copy
      ours.changes.forEach(prop => {
        counter++;
        let theirs: Record = head;
        Utils.copyProp(ours.data, merged, prop);
        while (theirs !== Record.blank && theirs.snapshot.timestamp > ours.snapshot.timestamp) {
          if (theirs.changes.has(prop)) {
            const same = Snapshot.same(theirs.data[prop], ours.data[prop]);
            if (Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(ours, false)}.${prop.toString()} ${same ? "==" : "<>"} ${Hint.record(theirs, false)}.${prop.toString()}.`);
            if (!same)
              ours.conflicts.set(prop, theirs);
            break;
          }
          else if (prop === RT_UNMOUNT || unmountTheirs) {
            if (Dbg.trace.changes) Dbg.log("║", "Y", `${Hint.record(ours, false)}.${prop.toString()} "<>" ${Hint.record(theirs, false)}.${prop.toString()}.`);
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

  static mergeObservers(target: Record, source: Record): void {
    source.observers.forEach((oo: Set<ICachedResult>, prop: PropertyKey) => {
      if (!target.changes.has(prop)) {
        const existing: Set<ICachedResult> | undefined = target.observers.get(prop);
        const merged = existing || new Set<ICachedResult>();
        if (!existing)
          target.observers.set(prop, merged);
        oo.forEach((c: ICachedResult) => {
          if (!c.isInvalid) {
            merged.add(c);
            if (Dbg.trace.subscriptions) Dbg.log(" ", "o", `${c.hint(false)} is subscribed to {${Hint.record(target, false, true, prop)}} - inherited from ${Hint.record(source, false, true, prop)}.`);
          }
        });
      }
    });
  }

  complete(error?: any): void {
    this._completed = true;
    this.changeset.forEach((r: Record, h: Handle) => {
      r.changes.forEach(prop => CopyOnWrite.seal(r.data, h.proxy, prop));
      r.freeze();
      h.writers--;
      if (h.writers === 0)
        h.changing = undefined;
      if (!error) {
        h.head = r;
        if (Dbg.trace.changes) {
          const props: string[] = [];
          r.changes.forEach(prop => props.push(prop.toString()));
          const s = props.join(", ");
          Dbg.log("║", "•", r.prev.record !== Record.blank ? `${Hint.record(r.prev.record)}(${s}) is overwritten.` : `${Hint.record(r)}(${s}) is created.`);
        }
      }
    });
    if (Dbg.trace.transactions)
      Dbg.log(this.timestamp < MAX_TIMESTAMP ? "╚══" : /* istanbul ignore next */ "═══", `v${this.timestamp}`, `${this.hint} - ${error ? "CANCEL" : "COMMIT"}(${this.changeset.size})${error ? ` - ${error}` : ``}`);
  }

  /* istanbul ignore next */
  static applyDependencies = function(snapshot: Snapshot, effect: ICachedResult[]): void {
    undef(); // to be redefined by Cache implementation
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
        Snapshot.oldest = undefined;
        Snapshot.pending.sort((a, b) => a._timestamp - b._timestamp);
        let i: number = 0;
        for (const x of Snapshot.pending) {
          if (!x.completed) {
            Snapshot.oldest = x;
            break;
          }
          else
            Snapshot.unlinkHistory(x);
          i++;
        }
        Snapshot.pending = Snapshot.pending.slice(i);
      }
    }
  }

  private static unlinkHistory(s: Snapshot): void {
    if (Dbg.trace.gc) Dbg.log("", " g", `snapshot t${s.id} (${s.hint}) is being collected`);
    s.changeset.forEach((r: Record, h: Handle) => {
      if (Dbg.trace.gc && r.prev.record !== Record.blank) Dbg.log("", " ·", `${Hint.record(r.prev.record)} is ready for GC (overwritten by ${Hint.record(r)}}`);
      Record.archive(r.prev.record);
      // Snapshot.mergeObservers(r, r.prev.record);
      r.prev.record = Record.blank; // unlink history
    });
  }
}

export class Hint {
  static handle(h: Handle, nameless?: boolean): string {
    return nameless ? `#${h.id}` : `#${h.id} ${h.hint}`;
  }

  static record(r: Record, tranless?: boolean, nameless?: boolean, prop?: PropertyKey): string {
    const t: string = tranless ? "" : `t${r.snapshot.id}`;
    const h: Handle | undefined = Utils.get(r.data, RT_HANDLE);
    const name: string = h ? `${t}${Hint.handle(h, nameless)}` : /* istanbul ignore next */ "blank";
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
    return Hint.record(theirs, false, false, prop);
  }
}
