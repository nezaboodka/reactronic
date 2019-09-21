// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Handle } from '../internal/all';
import { stateful } from './Reactivity.decorators';
import { Transaction } from './Transaction';

@stateful
export class Monitor {
  private _busy: boolean = false;
  private _counter: number = 0;
  private _workers = new Set<Worker>();
  readonly prolonged: boolean;
  get busy(): boolean { return this._busy; }
  get counter(): number { return this._counter; }
  get workers(): ReadonlySet<Worker> { return this._workers; }

  constructor(prolonged: boolean = false) {
    this.prolonged = prolonged;
  }

  static create(hint?: string, prolonged: boolean = false): Monitor {
    return Transaction.run("Monitor.create", Monitor.doCreate, hint, prolonged);
  }

  static enter(m: Monitor, worker: Worker): void {
    if (m._counter === 0)
      m._busy = true;
    m._counter++;
    m._workers.add(worker);
  }

  static leave(m: Monitor, worker: Worker): void {
    m._workers.delete(worker);
    m._counter--;
    if (m._counter === 0)
      m._busy = false;
  }

  private static doCreate(hint: string | undefined, prolonged: boolean): Monitor {
    return Handle.setHint(new Monitor(prolonged), hint);
  }
}

export interface Worker {
  // hint(tranless?: boolean): string;
  readonly tran: Transaction;
  // readonly progress: number; // 0..100
}
