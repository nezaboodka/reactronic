import { Trace } from './Trace';
import { F } from './internal/Record';
import { Virt } from './internal/Virtualization';
import { Config, Renew, Latency, ReentrantCall, SeparateFrom } from './Config';
import { Monitor } from './Monitor';

export function stateful(proto: object, prop?: PropertyKey): any {
  const config = { stateful: true };
  return prop ? Virt.decorateField(true, config, proto, prop) : Virt.decorateClass(true, config, proto);
}

export function stateless(proto: object, prop: PropertyKey): any {
  const config = { stateful: false };
  return Virt.decorateField(true, config, proto, prop);
}

export function transaction(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const config = { stateful: true };
  return Virt.decorateMethod(true, config, proto, prop, pd);
}

export function cache(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const config = { stateful: true, latency: Renew.OnDemand };
  return Virt.decorateMethod(true, config, proto, prop, pd);
}

export function behavior(latency?: Latency, reentrant?: ReentrantCall, separate?: SeparateFrom): F<any> {
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
      return Virt.decorateMethod(false, value, proto, prop, pd);
    else if (prop) /* istanbul ignore next */
      return Virt.decorateField(false, value, proto, prop);
    else
      return Virt.decorateClass(false, value, proto);
  };
}
