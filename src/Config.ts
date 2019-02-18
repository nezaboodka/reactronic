import { F } from "./internal/Record";
import { Hooks } from "./internal/Hooks";
import { Indicator } from "./Indicator";

export interface Config {
  readonly mode: Mode;
  readonly latency: Latency;
  readonly isolation: Isolation;
  readonly asyncCalls: AsyncCalls;
  readonly indicator: Indicator | null;
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

export function state(proto: object, prop?: PropertyKey): any {
  let config = { mode: Mode.Stateful };
  return prop ? Hooks.decorateField(config, proto, prop) : Hooks.decorateClass(config, proto);
}

export function stateless(proto: object, prop: PropertyKey): any {
  let config = { mode: Mode.Stateless };
  return Hooks.decorateField(config, proto, prop);
}

export function transaction(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  let config = { mode: Mode.Stateful, isolation: Isolation.Default };
  return Hooks.decorateMethod(config, proto, prop, pd);
}

export function cache(
  latency: Latency = Renew.OnDemand,
  isolation: Isolation = Isolation.Default,
  asyncCalls: AsyncCalls = AsyncCalls.Single): F<any> {
  return config({mode: Mode.Stateful, latency, isolation, asyncCalls});
}

export function indicator(value: Indicator | null): F<any> {
  return config({indicator: value});
}

export function config(value: Partial<Config>): F<any> {
  return function(proto: object, prop?: PropertyKey, pd?: TypedPropertyDescriptor<F<any>>): any {
    if (prop && pd)
      return Hooks.decorateMethod(value, proto, prop, pd);
    else if (prop)
      return Hooks.decorateField(value, proto, prop);
    else
      return Hooks.decorateClass(value, proto);
  };
}
