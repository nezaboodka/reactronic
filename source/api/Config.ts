// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Trace } from './Trace';
export { Trace } from './Trace';
import { Monitor } from './Monitor';

export interface Config {
  readonly stateful: boolean;
  readonly renewal: Renewal;
  readonly reentrant: ReentrantCalls;
  readonly separated: SeparatedFrom;
  readonly monitor: Monitor | null;
  readonly trace?: Partial<Trace>;
}

export type Renewal = number | Renew; // milliseconds

export enum Renew {
  ImmediatelyAsync = 0,
  Immediately = -1,
  OnDemand = -3, // default for cache
  Manually = -4,
  NoCache = -5, // default for transaction
}

export enum ReentrantCalls {
  ExitWithError = 1, // fail with error if there is an existing transaction in progress (default)
  WaitAndRestart = 0, // wait for existing transaction to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous transaction in favor of recent one
  RunSideBySide = -2, // multiple simultaneous transactions are allowed
}

export enum SeparatedFrom {
  None = 0,
  Reaction = 1,
  Parent = 2,
  Children = 4,
  All = 1 | 2 | 4,
}
