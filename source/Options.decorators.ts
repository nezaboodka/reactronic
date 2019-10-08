// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F } from './util/all'
import { Trace } from './Trace'
import { Hooks } from './core/Hooks'
import { Options, Reentrance, Kind } from './Options'
import { Monitor } from './Monitor'

export function stateful(proto: object, prop?: PropertyKey): any {
  const opt = { kind: Kind.Stateful }
  return prop ? Hooks.decorateField(true, opt, proto, prop) : Hooks.decorateClass(true, opt, proto)
}

export function stateless(proto: object, prop: PropertyKey): any {
  const opt = { kind: Kind.Stateless }
  return Hooks.decorateField(true, opt, proto, prop)
}

export function transaction(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Transaction }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function trigger(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Trigger, latency: -1 } // immediate trigger
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function cached(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
  const opt = { kind: Kind.Cached }
  return Hooks.decorateMethod(true, opt, proto, prop, pd)
}

export function latency(latency: number): F<any> {
  return options({latency})
}

export function reentrance(reentrance: Reentrance): F<any> {
  return options({reentrance})
}

export function cachedArgs(cachedArgs: boolean): F<any> {
  return options({cachedArgs})
}

export function monitor(monitor: Monitor | null): F<any> {
  return options({monitor})
}

export function trace(trace: Partial<Trace>): F<any> {
  return options({trace})
}

function options(options: Partial<Options>): F<any> {
  return function(proto: object, prop?: PropertyKey, pd?: TypedPropertyDescriptor<F<any>>): any {
    if (prop && pd)
      return Hooks.decorateMethod(false, options, proto, prop, pd) /* istanbul ignore next */
    else if (prop) /* istanbul ignore next */
      return Hooks.decorateField(false, options, proto, prop)
    else /* istanbul ignore next */
      return Hooks.decorateClass(false, options, proto)
  }
}
