// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from 'react'
import { ObservableObject, Transaction, unobservable, reaction, cached, standalone, Reactronic as R, TraceOptions } from 'api' // from 'reactronic'

export function autorender(render: (cycle: number) => JSX.Element, name?: string, trace?: Partial<TraceOptions>, op?: Transaction): JSX.Element {
  const [state, refresh] = React.useState<ReactState<JSX.Element>>(
    (!name && !trace) ? createReactState : () => createReactState(name, trace))
  const rx = state.rx
  rx.cycle = state.cycle
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.render(render, op)
}

// Internal

type ReactState<V> = { rx: Rx<V>, cycle: number }

class Rx<V> extends ObservableObject {
  @cached
  render(emit: (cycle: number) => V, op?: Transaction): V {
    return op ? op.inspect(() => emit(this.cycle)) : emit(this.cycle)
  }

  @reaction
  protected ensureUpToDate(): void {
    if (!R.getController(this.render).isUpToDate)
      standalone(this.refresh, {rx: this, cycle: this.cycle + 1})
  }

  @unobservable cycle: number = 0
  @unobservable refresh: (next: ReactState<V>) => void = nop
  @unobservable readonly unmount = (): (() => void) => {
    return (): void => standalone(() => Transaction.run(() => R.dispose(this)))
  }

  static create<V>(hint: string | undefined, trace: TraceOptions | undefined): Rx<V> {
    const rx = new Rx<V>()
    if (hint)
      R.setTraceHint(rx, hint)
    if (trace) {
      R.getController(rx.render).configure({trace})
      R.getController(rx.ensureUpToDate).configure({trace})
    }
    return rx
  }
}

function createReactState<V>(name?: string, trace?: Partial<TraceOptions>): ReactState<V> {
  const hint = name || (R.isTraceEnabled ? getComponentName() : '<rx>')
  const rx = Transaction.runAs<Rx<V>>({ hint, trace }, Rx.create, hint, trace)
  return {rx, cycle: 0}
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
  const i = lines.findIndex(x => x.indexOf(reaction.name) >= 0) || 6
  let result: string = lines[i + 1] || ''
  result = (result.match(/^\s*at\s*(\S+)/) || [])[1]
  return result !== undefined ? `<${result}>` : '<Rx>'
}
