// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Trace } from './Trace';
export { Trace } from './Trace';
import { Monitor } from './Monitor';

export interface Reactivity {
  readonly kind: Kind;
  readonly latency: number; // milliseconds, -1 is immediately, -2 is never
  readonly reentrance: Reentrance;
  readonly monitor: Monitor | null;
  readonly trace?: Partial<Trace>;
}

export enum Kind {
  Stateless = 0,
  Stateful = 1,
  Transaction = 2,
  Trigger = 3,
  Cached = 4,
}

export enum Reentrance {
  PreventWithError = 1, // fail with error if there is an existing transaction in progress (default)
  WaitAndRestart = 0, // wait for existing transaction to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous transaction in favor of recent one
  RunSideBySide = -2, // multiple simultaneous transactions are allowed
}
