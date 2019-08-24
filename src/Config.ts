import { Monitor } from "./Monitor";

export interface Config {
  readonly mode: Mode;
  readonly latency: Latency;
  readonly isolation: Isolation;
  readonly reentrance: Reentrance;
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

export enum Isolation {
  Default = 0, // prolonged for transactions, but consolidated standalone for reaction
  ProlongedTransaction = 1,
  SeparateTransaction = 2,
}

export enum Reentrance { // https://en.wikipedia.org/wiki/Reentrancy_(computing)
  Prevented = 1, // only one can run at a time (default)
  RestartLatter = 0, // restart latter after existing one
  CancelExisting = -1, // cancel existing in favor of latter one
  Unlimited = -2, // no limitations
}
