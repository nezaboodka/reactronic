// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Trace } from './Trace';
import { F } from '../internal/Record';
import { Hooks } from '../internal/Hooks';
import { Reactivity, Reentrance, Kind } from './Reactivity';
import { Monitor } from './Monitor';

export function stateful(proto: object, prop?: PropertyKey): any {
  const rx = { kind: Kind.Stateful };
  return prop ? Hooks.decorateField(true, rx, proto, prop) : Hooks.decorateClass(true, rx, proto);
}

export function stateless(proto: object, prop: PropertyKey): any {
  const rx = { kind: Kind.Stateless };
  return Hooks.decorateField(true, rx, proto, prop);
}

export function transaction(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const rx = { kind: Kind.Transaction };
  return Hooks.decorateMethod(true, rx, proto, prop, pd);
}

export function trigger(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const rx = { kind: Kind.Trigger, latency: -1 }; // immediate trigger
  return Hooks.decorateMethod(true, rx, proto, prop, pd);
}

export function cached(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const rx = { kind: Kind.Cached };
  return Hooks.decorateMethod(true, rx, proto, prop, pd);
}

export function latency(latency: number): F<any> {
  return reactivity({latency});
}

export function reentrance(reentrance: Reentrance): F<any> {
  return reactivity({reentrance});
}

export function monitor(value: Monitor | null): F<any> {
  return reactivity({monitor: value});
}

export function trace(value: Partial<Trace>): F<any> {
  return reactivity({trace: value});
}

export function reactivity(reactivity: Partial<Reactivity>): F<any> {
  return function(proto: object, prop?: PropertyKey, pd?: TypedPropertyDescriptor<F<any>>): any {
    if (prop && pd)
      return Hooks.decorateMethod(false, reactivity, proto, prop, pd);
    else if (prop) /* istanbul ignore next */
      return Hooks.decorateField(false, reactivity, proto, prop);
    else
      return Hooks.decorateClass(false, reactivity, proto);
  };
}
