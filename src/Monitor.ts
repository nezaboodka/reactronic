import { Handle } from "./internal/z.index";
import { Isolation } from "./Config";
import { stateful } from "./Config.decorators";
import { Transaction } from "./Transaction";

@stateful
export class Monitor {
  private _idle: boolean = true;
  private _volume: number = 0;
  private _operations = new Set<Operation>();
  readonly prolonged: boolean;
  readonly isolation: Isolation;
  get isIdle(): boolean { return this._idle; }
  get volume(): number { return this._volume; }
  get operations(): ReadonlySet<Operation> { return this._operations; }

  constructor(name?: string, prolonged: boolean = false, isolation: Isolation = Isolation.StandaloneTransaction) {
    Handle.setName(this, name);
    this.prolonged = prolonged;
    this.isolation = isolation;
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
