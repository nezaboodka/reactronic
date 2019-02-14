import { Utils, undef } from "./Utils";
import { Log } from "./Log";
import { Record, ISnapshot, ICache, RT_DISMISSED } from "./Record";
import { Handle, RT_HANDLE } from "./Handle";

// Snapshot

export class Snapshot implements ISnapshot {
  static lastUsedId: number = 16;
  static headTimestamp: number = 18;
  static activeSnapshots: Snapshot[] = [];
  static readonly zero: Snapshot = new Snapshot("zero");
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
    // to be redefined by Transaction implementation
    return Snapshot.zero;
  };

  readable(h: Handle): Record {
    let result = this.getRecord(h);
    if (!result) /* istanbul ignore next */
      throw new Error("E607: internal error");
    return result;
  }

  writable(h: Handle, prop: PropertyKey, value: Symbol): Record {
    let result: Record | undefined = this.tryGetWritable(h, prop, value);
    if (!result) /* istanbul ignore next */
      throw new Error("unknown error");
    return result;
  }

  tryGetWritable(h: Handle, prop: PropertyKey, value: any): Record | undefined {
    if (this.completed)
      throw new Error("E609: object can only be modified inside transaction");
    let r: Record | undefined = this.getRecord(h);
    if (!r || !Utils.equal(r.data[prop], value)) {
      let data = r ? r.data : value;
      if (!r || r.snapshot !== this) {
        data = Utils.copyAllProps(data, {});
        r = new Record(h.head, this, data);
        this.changeset.set(h, r);
        h.editing = r;
        h.editors++;
      }
      let v: any = r.prev.record ? r.prev.record.data[prop] : undefined;
      Record.markEdited(r, prop, !Utils.equal(v, value) /* && value !== RT_HANDLE*/);
      if (Log.verbosity >= 2) {
        let hint: string = "";
        if (Array.isArray(value))
          hint = `Array(${value.length})`;
        else if (value)
          hint = value.toString().slice(0, 20);
        else
          hint = "◌";
        Log.print("║", "w", `${Hint.record(r, true)}.${prop.toString()} = ${hint}`);
      }
    }
    else
      r = undefined; // ignore if property is set to the same value
    return r;
  }

  private getRecord(h: Handle): Record | undefined {
    this.checkout();
    let r: Record | undefined = h.editing;
    if (r && r.snapshot !== this) {
      r = this.changeset.get(h);
      if (r)
        h.editing = r; // remember last edit record
    }
    if (!r) {
      r = h.head;
      while (r && r.snapshot.timestamp > this.timestamp)
        r = r.prev.record;
    }
    return r;
  }

  checkout(): void {
    if (!this.completed && this.timestamp === Number.MAX_SAFE_INTEGER) {
      this._timestamp = Snapshot.headTimestamp;
      Snapshot.activeSnapshots.push(this);
      if (Log.verbosity >= 1) Log.print("╔═══", `v${this.timestamp}`, `${this.hint}`);
    }
  }

  rebase(): Record[] | undefined { // return conflicts
    let conflicts: Record[] | undefined = undefined;
    if (this.changeset.size > 0) {
      this.changeset.forEach((r: Record, h: Handle) => {
        let merged = Snapshot.mergeRecords(r, h.head);
        if (merged >= 0) {
          if (r.conflicts.size > 0) {
            if (!conflicts)
              conflicts = [];
            conflicts.push(r);
          }
          if (Log.verbosity >= 1) Log.print("║", "Y", `${Hint.record(r, true)} is merged among ${merged} properties with ${r.conflicts.size} conflicts.`);
        }
      });
      this._timestamp = ++Snapshot.headTimestamp;
    }
    return conflicts;
  }

  static mergeRecords(ours: Record, head: Record): number {
    let counter: number = -1;
    if (head.snapshot.timestamp > ours.snapshot.timestamp) {
      counter++;
      let theirsDismissed: boolean = head.edits.has(RT_DISMISSED);
      let merged = Utils.copyAllProps(head.data, {}); // create merged copy
      ours.edits.forEach((prop: PropertyKey) => {
        counter++;
        let theirs: Record | undefined = head;
        Utils.copyProp(ours.data, merged, prop);
        while (theirs && theirs.snapshot.timestamp > ours.snapshot.timestamp) {
          if (theirs.edits.has(prop)) {
            let diff = Utils.different(theirs.data[prop], ours.data[prop]);
            if (Log.verbosity >= 2) Log.print("║", "Y", `${Hint.record(ours, false)}.${prop.toString()} ${diff ? "!=" : "=="} ${Hint.record(theirs, false)}.${prop.toString()}.`);
            if (diff)
              ours.conflicts.set(prop, theirs);
            break;
          }
          else if (prop === RT_DISMISSED || theirsDismissed) {
            if (Log.verbosity >= 2) Log.print("║", "Y", `${Hint.record(ours, false)}.${prop.toString()} "!=" ${Hint.record(theirs, false)}.${prop.toString()}.`);
            ours.conflicts.set(prop, theirs);
            break;
          }
          else
            theirs = theirs.prev.record;
        }
      });
      Utils.copyAllProps(merged, ours.data); // overwrite with merged copy
    }
    return counter;
  }

  checkin(error?: any): void {
    this._completed = true;
    let last: string = "";
    let counter: number = 0;
    this.changeset.forEach((r: Record, h: Handle) => {
      r.finalize(h.proxy);
      h.editors--;
      if (h.editors === 0)
        h.editing = undefined;
      if (!error) {
        h.head = r;
        if (Log.verbosity >= 1) {
          let props: string[] = [];
          r.edits.forEach((prop: PropertyKey) => props.push(prop.toString()));
          let s = props.join(", ");
          if (s !== last) {
            if (counter > 0) {
              Log.print("║", "•", `  +${counter} similar (${last}) changes are applied.`);
              counter = 0;
            }
            Log.print("║", "•", `${Hint.record(r, true)}(${s}) is applied.`);
            last = s;
          }
          else
            counter++;
        }
      }
    });
    if (Log.verbosity >= 1) Log.print(this.timestamp > 0 ? "╚═══" : "═══", `v${this.timestamp}`, `${this.hint} - ${error ? "DISCARD" : "COMMIT"}(${this.changeset.size})${error ? ` - ${error}` : ``}`);
  }

  static applyNewDependencies = function(changeset: Map<Handle, Record>, effect: ICache[]): void {
    undef(); // to be redefined by Cache implementation
  };

  archive(): void {
    if (this.timestamp !== 0) {
      if (Snapshot.activeSnapshots[0] === this) {
        let i: number = 0;
        for (let x of Snapshot.activeSnapshots) {
          if (x.completed)
            x.archiveChangeset();
          else
            break;
          i++;
        }
        Snapshot.activeSnapshots = Snapshot.activeSnapshots.slice(i);
      }
    }
    Utils.freezeMap(this.changeset);
  }

  private archiveChangeset(): void {
    if (Log.verbosity >= 3) Log.print("", "gc", `t${this.id}: ${this.hint}`);
    this.changeset.forEach((r: Record, h: Handle) => {
      if (Log.verbosity >= 3 && r.prev.record) Log.print("", "gc", `${Hint.record(r.prev.record)} is ready for GC (overwritten by ${Hint.record(r)}}`);
      Record.archive(r.prev.record);
      r.prev.record = undefined; // unlink history
    });
  }

  static init(): void {
    Snapshot.zero._timestamp = 0;
    Snapshot.zero.checkin();
  }
}

export class Hint {
  static handle(h: Handle, typeless?: boolean): string {
    return `${h.hint ? `${h.hint}/` : ""}${typeless ? "" : h.type}#${h.id}`;
  }

  static record(r: Record, tranless?: boolean, typeless?: boolean, prop?: PropertyKey): string {
    let h: Handle = Utils.get(r.data, RT_HANDLE);
    let t: string = tranless ? "" : `t${r.snapshot.id}'`;
    return prop !== undefined ?
      `${t}${Hint.handle(h, typeless)}.${prop.toString()}` :
      `${t}${Hint.handle(h, typeless)}`;
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

Snapshot.init();
