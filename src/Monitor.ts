import { Handle } from "./internal/z.index";
import { SeparateFrom } from "./Config";
import { stateful } from "./Config.decorators";
import { Transaction } from "./Transaction";

@stateful
export class Monitor {
  private _idle: boolean = true;
  private _volume: number = 0;
  private _operations = new Set<Operation>();
  readonly prolonged: boolean;
  readonly separate: SeparateFrom;
  get isIdle(): boolean { return this._idle; }
  get volume(): number { return this._volume; }
  get operations(): ReadonlySet<Operation> { return this._operations; }

  constructor(hint?: string, prolonged: boolean = false, separate: SeparateFrom = SeparateFrom.All) {
    Handle.setHint(this, hint);
    this.prolonged = prolonged;
    this.separate = separate;
  }

  enter(op: Operation): void {
    if (this._volume === 0)
      this._idle = false;
    this._volume++;
    this._operations.add(op);
  }

  leave(op: Operation): void {
    this._operations.delete(op);
    this._volume--;
    if (this._volume === 0)
      this._idle = true;
  }

  static create(hint?: string): Monitor {
    return Transaction.run(() => new Monitor(hint));
  }
}

export interface Operation {
  // hint(tranless?: boolean): string;
  readonly tran: Transaction;
  // readonly progress: number; // 0..100
}
