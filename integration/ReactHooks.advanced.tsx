// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react'
import { Stateful, stateless, trigger, cached, cacheof, standalone, Transaction, Cache, Reactronic, Trace } from 'reactronic'

type ReactState = { rx: Rx, counter: number }

export function reactiveRender(render: (counter: number) => JSX.Element, trace?: Partial<Trace>): JSX.Element {
  return standalone(renderReactively, render, trace)
}

function renderReactively(render: (counter: number) => JSX.Element, trace?: Partial<Trace>): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(
    !trace ? createReactState : () => createReactState(trace))
  const rx = state.rx
  rx.counter = state.counter
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmountEffect, [])
  return rx.jsx(render)
}

class Rx extends Stateful {
  @cached
  jsx(render: (counter: number) => JSX.Element): JSX.Element {
    return render(this.counter)
  }

  @trigger
  keepFresh(): void {
    if (cacheof(this.jsx).isInvalid)
      this.refresh({rx: this, counter: this.counter + 1})
  }

  @stateless counter: number = 0
  @stateless refresh: (next: ReactState) => void = nop
  @stateless readonly unmountEffect = (): (() => void) => {
    return (): void => { Cache.unmount(this) }
  }
}

function createReactState(trace?: Partial<Trace>): ReactState {
  const hint = Reactronic.isTraceOn ? getComponentName() : "<rx>"
  const rx = Transaction.runAs<Rx>(hint, false, false, trace, undefined, createRx, hint, trace)
  return {rx, counter: 0}
}

function createRx(hint: string | undefined, trace: Trace | undefined): Rx {
  const rx = new Rx()
  if (hint)
    Reactronic.setTraceHint(rx, hint)
  if (trace) {
    cacheof(rx.jsx).setOptions({trace})
    cacheof(rx.keepFresh).setOptions({trace})
  }
  return rx
}

function nop(...args: any[]): void {
  // do nothing
}

function getComponentName(): string {
  const restore = Error.stackTraceLimit = 20
  const error = new Error()
  const stack = error.stack || ""
  Error.stackTraceLimit = restore
  const lines = stack.split("\n")
  const i = lines.findIndex(x => x.indexOf(".reactiveRender") >= 0) || 6
  let result: string = lines[i + 1] || ""
  result = (result.match(/^\s*at\s*(\S+)/) || [])[1]
  return `<${result}>`
}
