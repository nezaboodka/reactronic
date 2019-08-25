import { Monitor } from "./Monitor";

export interface Config {
  readonly mode: Mode;
  readonly latency: Latency;
  readonly dispart: Dispart;
  readonly reenter: Reenter;
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

export enum Dispart {
  Nope = 0,
  Default = 1, // = FromReaction
  FromReaction = 1,
  FromParent = 2,
  FromChildren = 4,
  FromAll = 1 + 2 + 4,
}

export enum Reenter { // https://en.wikipedia.org/wiki/Reentrancy_(computing)
  Prevent = 1, // only one can run at a time (default)
  RestartLatter = 0, // restart latter after existing one
  CancelExisting = -1, // cancel existing in favor of latter one
  Allow = -2, // no limitations
}
