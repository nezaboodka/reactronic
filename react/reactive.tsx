// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from 'react'
import { Stateful, Transaction, stateless, trigger, cached, isolated, Reactronic as R, LoggingOptions } from 'api' // from 'reactronic'

export function reactive(render: (cycle: number) => JSX.Element, name?: string, logging?: Partial<LoggingOptions>, tran?: Transaction): JSX.Element {
  const [state, refresh] = React.useState<ReactState<JSX.Element>>(
    (!name && !logging) ? createReactState : () => createReactState(name, logging))
  const rx = state.rx
  rx.cycle = state.cycle
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.render(render, tran)
}

// Internal

type ReactState<V> = { rx: Rx<V>, cycle: number }

class Rx<V> extends Stateful {
  @cached
  render(generate: (cycle: number) => V, tran?: Transaction): V {
    return tran ? tran.inspect(() => generate(this.cycle)) : generate(this.cycle)
  }

  @trigger
  protected pulse(): void {
    if (R.getMethodCache(this.render).invalid)
      isolated(this.refresh, {rx: this, cycle: this.cycle + 1})
  }

  @stateless cycle: number = 0
  @stateless refresh: (next: ReactState<V>) => void = nop
  @stateless readonly unmount = (): (() => void) => {
    return (): void => { isolated(R.dispose, this) }
  }

  static create<V>(hint: string | undefined, logging: LoggingOptions | undefined): Rx<V> {
    const rx = new Rx<V>()
    if (hint)
      R.setLoggingHint(rx, hint)
    if (logging) {
      R.getMethodCache(rx.render).configure({logging})
      R.getMethodCache(rx.pulse).configure({logging})
    }
    return rx
  }
}

function createReactState<V>(name?: string, logging?: Partial<LoggingOptions>): ReactState<V> {
  const hint = name || (R.isLogging ? getComponentName() : '<rx>')
  const rx = Transaction.runAs<Rx<V>>({ hint, logging }, Rx.create, hint, logging)
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
  const i = lines.findIndex(x => x.indexOf(reactive.name) >= 0) || 6
  let result: string = lines[i + 1] || ''
  result = (result.match(/^\s*at\s*(\S+)/) || [])[1]
  return result !== undefined ? `<${result}>` : '<Rx>'
}
