import { Handle } from "./internal/z.index";
import { state, Isolation } from "./Config";
import { Transaction } from "./Transaction";

@state
export class Monitor {
  static global: Monitor;

  private _idle: boolean = true;
  private _volume: number = 0;
  private _operations = new Set<Operation>();

  readonly isolation: Isolation;
  get isIdle(): boolean { return this._idle; }
  get volume(): number { return this._volume; }
  get operations(): ReadonlySet<Operation> { return this._operations; }

  constructor(name: string, isolation: Isolation = Isolation.StandaloneTransaction) {
    this.isolation = isolation;
    Handle.setHint(this, name);
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
}

export interface Operation {
  // hint(tranless?: boolean): string;
  readonly tran: Transaction;
  // readonly progress: number; // 0..100
}
