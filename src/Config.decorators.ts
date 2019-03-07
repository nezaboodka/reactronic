import { F } from "./internal/Record";
import { Hooks } from "./internal/Hooks";
import { Config, Mode, Renew, Latency, Isolation, AsyncCalls } from "./Config";
import { Monitor } from "./Monitor";

export function stateful(proto: object, prop?: PropertyKey): any {
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

export function monitor(value: Monitor | null): F<any> {
  return config({monitor: value});
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
