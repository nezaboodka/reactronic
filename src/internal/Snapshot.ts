import { Utils, undef } from "./Utils";
import { Debug } from "./Debug";
import { Record, ISnapshot, ICache, RT_UNMOUNT } from "./Record";
import { Handle, RT_HANDLE } from "./Handle";
import { CopyOnWrite } from "./Virtualization";

// Snapshot

export class Snapshot implements ISnapshot {
  static lastUsedId: number = 20;
  static headTimestamp: number = 100;
  static pending: Snapshot[] = [];
  static oldest: Snapshot | undefined = undefined;
  readonly id: number = 0;
  readonly hint: string = "";
  readonly changeset: Map<Handle, Record> = new Map<Handle, Record>();
  get timestamp(): number { return this._timestamp; }
  get completed(): boolean { return this._completed; }
  private _timestamp = Number.MAX_SAFE_INTEGER;
  private _completed = false;

  constructor(hint: string) {
    this.id = ++Snapshot.lastUsedId;
    this.hint = hint;
  }

  static active = function(): Snapshot {
    return undef(); // to be redefined by Transaction implementation
  };

  read(h: Handle): Record {
    let result = this.tryRead(h);
    if (result === Record.empty) /* istanbul ignore next */
      throw new Error("E607: internal error");
    return result;
  }

  edit(h: Handle, prop: PropertyKey, value: Symbol): Record {
    let result: Record = this.tryEdit(h, prop, value);
    if (result === Record.empty) /* istanbul ignore next */
      throw new Error("unknown error");
    return result;
  }

  tryRead(h: Handle): Record {
    let r: Record | undefined = h.editing;
    if (r && r.snapshot !== this) {
      r = this.changeset.get(h);
      if (r)
        h.editing = r; // remember last edit record
    }
    if (!r) {
      r = h.head;
      while (r !== Record.empty && r.snapshot.timestamp > this.timestamp)
        r = r.prev.record;
    }
    return r;
  }

  tryEdit(h: Handle, prop: PropertyKey, value: any): Record {
    if (this.completed)
      throw new Error("E609: object can only be modified inside transaction");
    let r: Record = this.tryRead(h);
    if (r === Record.empty || !Utils.equal(r.data[prop], value)) {
      let data = r ? r.data : value;
      if (!r || r.snapshot !== this) {
        data = Utils.copyAllProps(data, {});
        r = new Record(h.head, this, data);
        Reflect.set(r.data, RT_HANDLE, h);
        this.changeset.set(h, r);
        h.editing = r;
        h.editors++;
      }
    }
    else
      r = Record.empty; // ignore if property is set to the same value
    return r;
  }

  checkout(): void {
    if (!this.completed && this.timestamp === Number.MAX_SAFE_INTEGER) {
      this._timestamp = Snapshot.headTimestamp;
      Snapshot.pending.push(this);
      if (Snapshot.oldest === undefined)
        Snapshot.oldest = this;
      if (Debug.verbosity >= 2) Debug.log("╔══", `v${this.timestamp}`, `${this.hint}`);
    }
  }

  rebase(): Record[] | undefined { // return conflicts
    let conflicts: Record[] | undefined = undefined;
    if (this.changeset.size > 0) {
      this.changeset.forEach((r: Record, h: Handle) => {
        let merged = Snapshot.rebaseRecord(r, h.head);
        if (merged >= 0) {
          if (r.conflicts.size > 0) {
            if (!conflicts)
              conflicts = [];
            conflicts.push(r);
          }
          if (Debug.verbosity >= 3) Debug.log("║", "Y", `${Hint.record(r, true)} is merged with ${Hint.record(h.head, false)} among ${merged} properties with ${r.conflicts.size} conflicts.`);
        }
      });
      this._timestamp = ++Snapshot.headTimestamp;
    }
    return conflicts;
  }

  static rebaseRecord(ours: Record, head: Record): number {
    let counter: number = -1;
    if (head !== Record.empty && head.snapshot.timestamp > ours.snapshot.timestamp) {
      counter++;
      let unmountTheirs: boolean = head.edits.has(RT_UNMOUNT);
      let merged = Utils.copyAllProps(head.data, {}); // create merged copy
      ours.edits.forEach(prop => {
        counter++;
        let theirs: Record = head;
        Utils.copyProp(ours.data, merged, prop);
        while (theirs !== Record.empty && theirs.snapshot.timestamp > ours.snapshot.timestamp) {
          if (theirs.edits.has(prop)) {
            let diff = Utils.different(theirs.data[prop], ours.data[prop]);
            if (Debug.verbosity >= 3) Debug.log("║", "Y", `${Hint.record(ours, false)}.${prop.toString()} ${diff ? "!=" : "=="} ${Hint.record(theirs, false)}.${prop.toString()}.`);
            if (diff)
              ours.conflicts.set(prop, theirs);
            break;
          }
          else if (prop === RT_UNMOUNT || unmountTheirs) {
            if (Debug.verbosity >= 3) Debug.log("║", "Y", `${Hint.record(ours, false)}.${prop.toString()} "!=" ${Hint.record(theirs, false)}.${prop.toString()}.`);
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
    source.observers.forEach((oo: Set<ICache>, prop: PropertyKey) => {
      if (!target.edits.has(prop)) {
        let existing: Set<ICache> | undefined = target.observers.get(prop);
        let merged = existing || new Set<ICache>();
        if (!existing)
          target.observers.set(prop, merged);
        oo.forEach((c: ICache) => {
          if (!c.isInvalidated()) {
            merged.add(c);
            if (Debug.verbosity >= 3) Debug.log(" ", "∞", `${c.hint(false)} is subscribed to {${Hint.record(target, false, true, prop)}} - inherited from ${Hint.record(source, false, true, prop)}.`);
          }
        });
      }
    });
  }

  checkin(error?: any): void {
    this._completed = true;
    this.changeset.forEach((r: Record, h: Handle) => {
      r.edits.forEach(prop => CopyOnWrite.seal(r.data, h.proxy, prop));
      r.freeze();
      h.editors--;
      if (h.editors === 0)
        h.editing = undefined;
      if (!error) {
        h.head = r;
        if (Debug.verbosity >= 3) {
          let props: string[] = [];
          r.edits.forEach(prop => props.push(prop.toString()));
          let s = props.join(", ");
          Debug.log("║", "•", r.prev.record !== Record.empty ? `${Hint.record(r.prev.record)}(${s}) is overwritten.` : `${Hint.record(r)}(${s}) is created.`);
        }
      }
    });
    if (Debug.verbosity >= 2) Debug.log(this.timestamp > 0 ? "╚══" : "═══", `v${this.timestamp}`, `${this.hint} - ${error ? "DISCARD" : "COMMIT"}(${this.changeset.size})${error ? ` - ${error}` : ``}`);
  }

  static applyDependencies = function(changeset: Map<Handle, Record>, effect: ICache[]): void {
    undef(); // to be redefined by Cache implementation
  };

  archive(): void {
    Snapshot.gc(this);
    Utils.freezeMap(this.changeset);
  }

  private static gc(s: Snapshot): void {
    if (s.timestamp !== 0) {
      if (s === Snapshot.oldest) {
        Snapshot.oldest = undefined;
        Snapshot.pending.sort((a, b) => a._timestamp - b._timestamp);
        let i: number = 0;
        for (let x of Snapshot.pending) {
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
    if (Debug.verbosity >= 5) Debug.log("", "  ", `Transaction "t${s.id}: ${s.hint}" is being collected`);
    s.changeset.forEach((r: Record, h: Handle) => {
      if (Debug.verbosity >= 5 && r.prev.record !== Record.empty) Debug.log("", "gc", `${Hint.record(r.prev.record)} is ready for GC (overwritten by ${Hint.record(r)}}`);
      Record.archive(r.prev.record);
      // Snapshot.mergeObservers(r, r.prev.record);
      r.prev.record = Record.empty; // unlink history
    });
  }
}

export class Hint {
  static handle(h: Handle, nameless?: boolean): string {
    return nameless ? `#${h.id}` : `#${h.id} ${h.name}`;
  }

  static record(r: Record, tranless?: boolean, nameless?: boolean, prop?: PropertyKey): string {
    let t: string = tranless ? "" : `t${r.snapshot.id}`;
    let h: Handle | undefined = Utils.get(r.data, RT_HANDLE);
    let name: string = h ? `${t}${Hint.handle(h, nameless)}` : "[new]";
    return prop !== undefined ? `${name}.${prop.toString()}` : `${name}`;
  }

  static conflicts(conflicts: Record[]): string {
    return conflicts.map(ours => {
      let items: string[] = [];
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
