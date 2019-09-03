import { F } from "./internal/Record";
import { Virt } from "./internal/Virtualization";
import { Config, Mode, Renew, Latency, ReentrantCall, SeparateFrom } from "./Config";
import { Monitor } from "./Monitor";

export function stateful(proto: object, prop?: PropertyKey): any {
  const config = { mode: Mode.Stateful };
  return prop ? Virt.decorateField(config, true, proto, prop) : Virt.decorateClass(config, true, proto);
}

export function stateless(proto: object, prop: PropertyKey): any {
  const config = { mode: Mode.Stateless };
  return Virt.decorateField(config, true, proto, prop);
}

export function transaction(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const config = { mode: Mode.Stateful };
  return Virt.decorateMethod(config, true, proto, prop, pd);
}

export function cache(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const config = { mode: Mode.Stateful, latency: Renew.OnDemand };
  return Virt.decorateMethod(config, true, proto, prop, pd);
}

export function config(latency?: Latency, reentrant?: ReentrantCall, separate?: SeparateFrom): F<any> {
  return reactivity({mode: Mode.Stateful, latency, reentrant, separate});
}

export function monitor(value: Monitor | null): F<any> {
  return reactivity({monitor: value});
}

export function tracing(value: number): F<any> {
  return reactivity({tracing: value});
}

export function reactivity(value: Partial<Config>): F<any> {
  return function(proto: object, prop?: PropertyKey, pd?: TypedPropertyDescriptor<F<any>>): any {
    if (prop && pd)
      return Virt.decorateMethod(value, false, proto, prop, pd);
    else if (prop)
      return Virt.decorateField(value, false, proto, prop);
    else
      return Virt.decorateClass(value, false, proto);
  };
}
