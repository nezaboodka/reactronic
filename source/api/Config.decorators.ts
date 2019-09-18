// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Trace } from './Trace';
import { F } from '../internal/Record';
import { Hooks } from '../internal/Hooks';
import { Config, Reentrance, Kind } from './Config';
import { Monitor } from './Monitor';

export function stateful(proto: object, prop?: PropertyKey): any {
  const config = { kind: Kind.Stateful };
  return prop ? Hooks.decorateField(true, config, proto, prop) : Hooks.decorateClass(true, config, proto);
}

export function stateless(proto: object, prop: PropertyKey): any {
  const config = { kind: Kind.Stateless };
  return Hooks.decorateField(true, config, proto, prop);
}

export function transaction(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const config = { kind: Kind.Transaction };
  return Hooks.decorateMethod(true, config, proto, prop, pd);
}

export function trigger(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const config = { kind: Kind.Trigger, latency: -1 }; // immediate trigger
  return Hooks.decorateMethod(true, config, proto, prop, pd);
}

export function cached(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const config = { kind: Kind.Cached };
  return Hooks.decorateMethod(true, config, proto, prop, pd);
}

export function behavior(latency?: number, reentrance?: Reentrance): F<any> {
  return config({latency, reentrance});
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
