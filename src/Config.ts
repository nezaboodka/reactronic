import { Monitor } from "./Monitor";

export interface Config {
  readonly mode: Mode;
  readonly latency: Latency;
  readonly reentrant: ReentrantCall;
  readonly separate: SeparateFrom;
  readonly monitor: Monitor | null;
  readonly tracing: number;
}

export enum Mode {
  Stateful = 0, // default
  Stateless = 1,
}

export type Latency = number | Renew; // milliseconds

export enum Renew {
  Immediately = -1,
  WhenReady = -2,
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
