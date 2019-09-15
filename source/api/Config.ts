// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Trace } from './Trace';
export { Trace } from './Trace';
import { Monitor } from './Monitor';

export interface Config {
  readonly stateful: boolean;
  readonly renew: Renewal;
  readonly reentrance: Reentrance;
  readonly execution: Execution;
  readonly monitor: Monitor | null;
  readonly trace?: Partial<Trace>;
}

export type Renewal = Renew | number; // milliseconds

export enum Renew {
  ImmediatelyAsync = 0, // @reactive
  Immediately = -1,
  OnDemand = -3, // @cached
  Manually = -4,
  Off = -5, // @transaction
}

export enum Reentrance {
  PreventWithError = 1, // fail with error if there is an existing transaction in progress (default)
  WaitAndRestart = 0, // wait for existing transaction to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous transaction in favor of recent one
  RunSideBySide = -2, // multiple simultaneous transactions are allowed
}

export enum Execution {
  InsideParent = 0,
  Standalone = 1,
  AfterParent = 2,
}
