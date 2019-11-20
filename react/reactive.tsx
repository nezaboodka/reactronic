// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react'
import { State, Action, Cache, stateless, trigger, cached, escape, Tools as RT, Trace } from 'reactronic'

export function reactive(render: (counter: number) => JSX.Element, trace?: Partial<Trace>, action?: Action): JSX.Element {
  const [state, refresh] = React.useState<ReactState<JSX.Element>>(
    !trace ? createReactState : () => createReactState(trace))
  const rx = state.rx
  rx.counter = state.counter
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.view(render, action)
}

// Internal

type ReactState<V> = { rx: Rx<V>, counter: number }

class Rx<V> extends State {
  @cached
  view(generate: (counter: number) => V, action?: Action): V {
    return action ? action.inspect(() => generate(this.counter)) : generate(this.counter)
  }

  @trigger
  keepFresh(): void {
    if (Cache.of(this.view).invalid)
      escape(this.refresh, {rx: this, counter: this.counter + 1})
  }

  @stateless counter: number = 0
  @stateless refresh: (next: ReactState<V>) => void = nop
  @stateless readonly unmount = (): (() => void) => {
    return (): void => { escape(Cache.unmount, this) }
  }
}

function createReactState<V>(trace?: Partial<Trace>): ReactState<V> {
  const hint = RT.isTraceOn ? getComponentName() : '<rx>'
  const rx = Action.runAs<Rx<V>>(hint, false, trace, undefined, createRx, hint, trace)
  return {rx, counter: 0}
}

function createRx<V>(hint: string | undefined, trace: Trace | undefined): Rx<V> {
  const rx = new Rx<V>()
  if (hint)
    RT.setTraceHint(rx, hint)
  if (trace) {
    Cache.of(rx.view).setup({trace})
    Cache.of(rx.keepFresh).setup({trace})
  }
  return rx
}

function nop(...args: any[]): void {
  // do nothing
}

function getComponentName(): string {
  const restore = Error.stackTraceLimit = 20
  const error = new Error()
  const stack = error.stack || ''
  Error.stackTraceLimit = restore
  const lines = stack.split('\n')
  const i = lines.findIndex(x => x.indexOf(reactive.name) >= 0) || 6
  let result: string = lines[i + 1] || ''
  result = (result.match(/^\s*at\s*(\S+)/) || [])[1]
  return result !== undefined ? `<${result}>` : '<Rx>'
}
