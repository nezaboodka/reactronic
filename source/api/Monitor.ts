// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Handle } from '../internal/all';
import { Start } from './Config';
import { stateful } from './Config.decorators';
import { Transaction } from './Transaction';

@stateful
export class Monitor {
  private _idle: boolean = true;
  private _counter: number = 0;
  private _workers = new Set<Worker>();
  readonly prolonged: boolean;
  readonly start: Start;
  get isIdle(): boolean { return this._idle; }
  get counter(): number { return this._counter; }
  get workers(): ReadonlySet<Worker> { return this._workers; }

  constructor(prolonged: boolean = false, start: Start = Start.Standalone) {
    this.prolonged = prolonged;
    this.start = start;
  }

  static create(hint?: string, prolonged: boolean = false, execute: Start = Start.Standalone): Monitor {
    return Transaction.run("Monitor.create", Monitor.doCreate, hint, prolonged, execute);
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

  private static doCreate(hint: string | undefined, prolonged: boolean, start: Start): Monitor {
    return Handle.setHint(new Monitor(prolonged, start), hint);
  }
}

export interface Worker {
  // hint(tranless?: boolean): string;
  readonly tran: Transaction;
  // readonly progress: number; // 0..100
}
