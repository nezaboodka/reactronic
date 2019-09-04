import { Handle } from "./internal/z.index";
import { SeparateFrom } from "./Config";
import { stateful } from "./Config.decorators";
import { Transaction } from "./Transaction";

@stateful
export class Monitor {
  private _idle: boolean = true;
  private _counter: number = 0;
  private _operations = new Set<Operation>();
  readonly prolonged: boolean;
  readonly separate: SeparateFrom;
  get isIdle(): boolean { return this._idle; }
  get counter(): number { return this._counter; }
  get operations(): ReadonlySet<Operation> { return this._operations; }

  constructor(prolonged: boolean = false, separate: SeparateFrom = SeparateFrom.All) {
    this.prolonged = prolonged;
    this.separate = separate;
  }

  enter(op: Operation): void {
    if (this._counter === 0)
      this._idle = false;
    this._counter++;
    this._operations.add(op);
  }

  leave(op: Operation): void {
    this._operations.delete(op);
    this._counter--;
    if (this._counter === 0)
      this._idle = true;
  }

  static create(hint?: string): Monitor {
    return Transaction.run(() => Handle.setHint(new Monitor(), hint));
  }
}

export interface Operation {
  // hint(tranless?: boolean): string;
  readonly tran: Transaction;
  // readonly progress: number; // 0..100
}
