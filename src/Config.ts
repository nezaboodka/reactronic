import { Monitor } from "./Monitor";

export interface Config {
  readonly mode: Mode;
  readonly latency: Latency;
  readonly isolation: Isolation;
  readonly asyncCalls: AsyncCalls;
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
  OnDemand = -2, // default for cache
  Manually = -3,
  DoesNotCache = -4, // default for transaction
}

export enum Isolation {
  Default = 0, // prolonged for transactions, but consolidated standalone for reaction
  ProlongedTransaction = 1,
  StandaloneTransaction = 2,
}

export enum AsyncCalls {
  Single = 1, // only one can run at a time (default)
  Reused = 0, // reuse existing (if any)
  Relayed = -1, // cancel existing in favor of newer one
  Multiple = -2,
}
