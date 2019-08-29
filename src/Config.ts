import { Monitor } from "./Monitor";

export interface Config {
  readonly mode: Mode;
  readonly latency: Latency;
  readonly asyncMode: AsyncMode;
  readonly apartFrom: ApartFrom;
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

export enum AsyncMode { // https://en.wikipedia.org/wiki/Reentrancy_(computing)
  PreventReentrance = 1, // fail with error if there is an existing transaction in progress (default)
  RestartChallenger = 0, // wait for existing transaction to finish and then restart reentrant one
  DiscardExisting = -1, // discard existing transaction in favor of recent one
  DiscardExistingNoWait = -2, // discard existing transaction, but don't wait for its finish
  AllowReentrance = -3, // multiple simultaneous transactions are allowed
}

export enum ApartFrom {
  None = 0,
  Reaction = 1,
  Parent = 2,
  Children = 4,
  All = 1 + 2 + 4,
}
