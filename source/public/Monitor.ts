// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.

// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Handle } from '../internal/z.index';
import { SeparatedFrom } from './Config';
import { stateful } from './Config.decorators';
import { Transaction } from './Transaction';

@stateful
export class Monitor {
  private _idle: boolean = true;
  private _counter: number = 0;
  private _workers = new Set<Worker>();
  readonly prolonged: boolean;
  readonly separated: SeparatedFrom;
  get isIdle(): boolean { return this._idle; }
  get counter(): number { return this._counter; }
  get workers(): ReadonlySet<Worker> { return this._workers; }

  constructor(prolonged: boolean = false, separated: SeparatedFrom = SeparatedFrom.All) {
    this.prolonged = prolonged;
    this.separated = separated;
  }

  static create(hint?: string, prolonged: boolean = false, separated: SeparatedFrom = SeparatedFrom.All): Monitor {
    return Transaction.run("Monitor.create", Monitor.runCreate, hint, prolonged, separated);
  }

  static enter(m: Monitor, worker: Worker): void {
    if (m._counter === 0)
      m._idle = false;
    m._counter++;
    m._workers.add(worker);
  }

  static leave(m: Monitor, worker: Worker): void {
    m._workers.delete(worker);
    m._counter--;
    if (m._counter === 0)
      m._idle = true;
  }

  private static runCreate(hint: string | undefined, prolonged: boolean, separated: SeparatedFrom): Monitor {
    return Handle.setHint(new Monitor(prolonged, separated), hint);
  }
}

export interface Worker {
  // hint(tranless?: boolean): string;
  readonly tran: Transaction;
  // readonly progress: number; // 0..100
}
