import { Trace } from './Trace';
export { Trace } from './Trace';
import { Monitor } from './Monitor';

export interface Config {
  readonly stateful: boolean;
  readonly latency: Latency;
  readonly reentrant: ReentrantCall;
  readonly separate: SeparateFrom;
  readonly monitor: Monitor | null;
  readonly trace?: Partial<Trace>;
}

export type Latency = number | Renew; // milliseconds

export enum Renew {
  InstantAsync = 0,
  Instantly = -1,
  OnDemand = -3, // default for cache
  Manually = -4,
  NoCache = -5, // default for transaction
}

export enum ReentrantCall {
  ExitWithError = 1, // fail with error if there is an existing transaction in progress (default)
  WaitAndRestart = 0, // wait for existing transaction to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous transaction in favor of recent one
  RunSideBySide = -2, // multiple simultaneous transactions are allowed
}

export enum SeparateFrom {
  None = 0,
  Reaction = 1,
  Parent = 2,
  Children = 4,
  All = 1 | 2 | 4,
}
