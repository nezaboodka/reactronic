import { Handle } from "./internal/z.index";
import { SeparateFrom } from "./Config";
import { stateful } from "./Config.decorators";
import { Transaction } from "./Transaction";

@stateful
export class Monitor {
  private _idle: boolean = true;
  private _counter: number = 0;
  private _workers = new Set<Worker>();
  readonly prolonged: boolean;
  readonly separate: SeparateFrom;
  get isIdle(): boolean { return this._idle; }
  get counter(): number { return this._counter; }
  get workers(): ReadonlySet<Worker> { return this._workers; }

  constructor(prolonged: boolean = false, separate: SeparateFrom = SeparateFrom.All) {
    this.prolonged = prolonged;
    this.separate = separate;
  }

  enter(worker: Worker): void {
    if (this._counter === 0)
      this._idle = false;
    this._counter++;
    this._workers.add(worker);
  }

  leave(worker: Worker): void {
    this._workers.delete(worker);
    this._counter--;
    if (this._counter === 0)
      this._idle = true;
  }

  static create(hint?: string): Monitor {
    return Transaction.run(() => Handle.setHint(new Monitor(), hint));
  }
}

export interface Worker {
  // hint(tranless?: boolean): string;
  readonly tran: Transaction;
  // readonly progress: number; // 0..100
}
