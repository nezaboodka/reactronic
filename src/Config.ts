import { Monitor } from "./Monitor";

export interface Config {
  readonly mode: Mode;
  readonly latency: Latency;
  readonly reentrance: Reentrance;
  readonly apart: ApartFrom;
  readonly monitor: Monitor | null;
  readonly tracing: number;
}

export enum Mode {
  Stateless = -1,
  Stateful = 0, // default
  InternalStateful = 1,
}

export type Latency = number | Renew; // milliseconds

export enum Renew {
  Immediately = -1,
  WhenReady = -2,
  OnDemand = -3, // default for cache
  Manually = -4,
  NoCache = -5, // default for transaction
}

export enum ApartFrom {
  None = 0,
  Reaction = 1,
  Parent = 2,
  Children = 4,
  All = 1 + 2 + 4,
}

export enum Reentrance { // https://en.wikipedia.org/wiki/Reentrancy_(computing)
  Prevent = 1, // only one can run at a time (default)
  WaitAndRestart = 0, // wait for preceding to complete and then restart latter one
  DiscardPreceding = -1, // discard preceding call in favor of latter one
  Allow = -2, // no limitations
}
