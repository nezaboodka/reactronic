// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Handle, Stateful } from '../internal/all';
import { Transaction } from './Transaction';

export class Monitor extends Stateful {
  private _busy: boolean = false;
  private _counter: number = 0;
  private _workers = new Set<Worker>();
  get busy(): boolean { return this._busy; }
  get counter(): number { return this._counter; }
  get workers(): ReadonlySet<Worker> { return this._workers; }

  static create(hint?: string): Monitor {
    return Transaction.run("Monitor.create", Monitor.createFunc, hint);
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

  private static createFunc(hint: string | undefined): Monitor {
    return Handle.setHint(new Monitor(), hint);
  }
}

export interface Worker {
  // hint(tranless?: boolean): string;
  readonly tran: Transaction;
  // readonly progress: number; // 0..100
}
