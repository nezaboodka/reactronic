import { Trace } from './Trace';
import { F } from './internal/Record';
import { Hooks } from './internal/Hooks';
import { Config, Renew, Latency, ReentrantCalls, SeparateFrom } from './Config';
import { Monitor } from './Monitor';

export function stateful(proto: object, prop?: PropertyKey): any {
  const config = { stateful: true };
  return prop ? Hooks.decorateField(true, config, proto, prop) : Hooks.decorateClass(true, config, proto);
}

export function stateless(proto: object, prop: PropertyKey): any {
  const config = { stateful: false };
  return Hooks.decorateField(true, config, proto, prop);
}

export function transaction(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const config = { stateful: true };
  return Hooks.decorateMethod(true, config, proto, prop, pd);
}

export function cache(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const config = { stateful: true, latency: Renew.OnDemand };
  return Hooks.decorateMethod(true, config, proto, prop, pd);
}

export function behavior(latency?: Latency, reentrant?: ReentrantCalls, separate?: SeparateFrom): F<any> {
  return config({latency, reentrant, separate});
}

export function monitor(value: Monitor | null): F<any> {
  return config({monitor: value});
}

export function trace(value: Partial<Trace>): F<any> {
  return config({trace: value});
}

export function config(value: Partial<Config>): F<any> {
  return function(proto: object, prop?: PropertyKey, pd?: TypedPropertyDescriptor<F<any>>): any {
    if (prop && pd)
      return Hooks.decorateMethod(false, value, proto, prop, pd);
    else if (prop) /* istanbul ignore next */
      return Hooks.decorateField(false, value, proto, prop);
    else
      return Hooks.decorateClass(false, value, proto);
  };
}
