import { F } from "./internal/Record";
import { Virt } from "./internal/Virtualization";
import { Config, Mode, Renew, Latency, ReentrantCall, ApartFrom } from "./Config";
import { Monitor } from "./Monitor";

export function stateful(proto: object, prop?: PropertyKey): any {
  let config = { mode: Mode.Stateful };
  return prop ? Virt.decorateField(config, proto, prop) : Virt.decorateClass(config, proto);
}

export function stateless(proto: object, prop: PropertyKey): any {
  let config = { mode: Mode.Stateless };
  return Virt.decorateField(config, proto, prop);
}

export function transaction(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  let config = { mode: Mode.Stateful };
  return Virt.decorateMethod(config, proto, prop, pd);
}

export function cache(
  latency: Latency = Renew.OnDemand,
  reentrant: ReentrantCall = ReentrantCall.ExitWithError,
  apart: ApartFrom = ApartFrom.Reaction): F<any> {
  return config({mode: Mode.Stateful, latency, reentrant, apart});
}

export function monitor(value: Monitor | null): F<any> {
  return config({monitor: value});
}

export function tracing(value: number): F<any> {
  return config({tracing: value});
}

export function config(value: Partial<Config>): F<any> {
  return function(proto: object, prop?: PropertyKey, pd?: TypedPropertyDescriptor<F<any>>): any {
    if (prop && pd)
      return Virt.decorateMethod(value, proto, prop, pd);
    else if (prop)
      return Virt.decorateField(value, proto, prop);
    else
      return Virt.decorateClass(value, proto);
  };
}
