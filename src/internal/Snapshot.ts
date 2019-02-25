import { Utils, undef } from "./Utils";
import { Debug } from "./Debug";
import { Record, ISnapshot, ICache, RT_UNMOUNT } from "./Record";
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
      Record.markEdited(r, prop, !Utils.equal(v, value) /* && value !== RT_HANDLE*/, value);
    }
    else
      r = undefined; // ignore if property is set to the same value
    return r;
  }

  private getRecord(h: Handle): Record | undefined {
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
      if (Debug.verbosity >= 1) Debug.log("╔═══", `v${this.timestamp}`, `${this.hint}`);
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
          if (Debug.verbosity >= 1) Debug.log("║", "Y", `${Hint.record(r, true)} is merged with ${Hint.record(h.head, false)} among ${merged} properties with ${r.conflicts.size} conflicts.`);
        }
      });
      this._timestamp = ++Snapshot.headTimestamp;
    }
    return conflicts;
  }

  static rebaseRecord(ours: Record, head: Record): number {
    let counter: number = -1;
    if (head.snapshot.timestamp > ours.snapshot.timestamp) {
      counter++;
      let unmountTheirs: boolean = head.edits.has(RT_UNMOUNT);
      let merged = Utils.copyAllProps(head.data, {}); // create merged copy
      ours.edits.forEach((prop: PropertyKey) => {
        counter++;
        let theirs: Record | undefined = head;
        Utils.copyProp(ours.data, merged, prop);
        while (theirs && theirs.snapshot.timestamp > ours.snapshot.timestamp) {
          if (theirs.edits.has(prop)) {
            let diff = Utils.different(theirs.data[prop], ours.data[prop]);
            if (Debug.verbosity >= 2) Debug.log("║", "Y", `${Hint.record(ours, false)}.${prop.toString()} ${diff ? "!=" : "=="} ${Hint.record(theirs, false)}.${prop.toString()}.`);
            if (diff)
              ours.conflicts.set(prop, theirs);
            break;
          }
          else if (prop === RT_UNMOUNT || unmountTheirs) {
            if (Debug.verbosity >= 2) Debug.log("║", "Y", `${Hint.record(ours, false)}.${prop.toString()} "!=" ${Hint.record(theirs, false)}.${prop.toString()}.`);
            ours.conflicts.set(prop, theirs);
            break;
          }
          else
            theirs = theirs.prev.record;
        }
      });
      Utils.copyAllProps(merged, ours.data); // overwrite with merged copy
      ours.prev.record = head;
    }
    return counter;
  }

  checkin(error?: any): void {
    this._completed = true;
    this.changeset.forEach((r: Record, h: Handle) => {
      r.finalize(h.proxy);
      h.editors--;
      if (h.editors === 0)
        h.editing = undefined;
      if (!error) {
        h.head = r;
        if (Debug.verbosity >= 1) {
          let props: string[] = [];
          r.edits.forEach((prop: PropertyKey) => props.push(prop.toString()));
          let s = props.join(", ");
          Debug.log("║", "•", `${Hint.record(r, true)}(${s}) is applied.`);
        }
      }
    });
    if (Debug.verbosity >= 1) Debug.log(this.timestamp > 0 ? "╚═══" : "═══", `v${this.timestamp}`, `${this.hint} - ${error ? "DISCARD" : "COMMIT"}(${this.changeset.size})${error ? ` - ${error}` : ``}`);
  }

  static applyDependencies = function(changeset: Map<Handle, Record>, effect: ICache[]): void {
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
    if (Debug.verbosity >= 3) Debug.log("", "gc", `t${this.id}: ${this.hint}`);
    this.changeset.forEach((r: Record, h: Handle) => {
      if (Debug.verbosity >= 3 && r.prev.record) Debug.log("", "gc", `${Hint.record(r.prev.record)} is ready for GC (overwritten by ${Hint.record(r)}}`);
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
    return typeless ? `#${h.id}` : `${h.hint ? h.hint : h.type}#${h.id}`;
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
