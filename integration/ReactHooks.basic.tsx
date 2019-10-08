// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react'
import { Stateful, stateless, trigger, cached, cacheof, standalone, Transaction, Cache } from 'core/api'

type ReactState = { rx: Rx }

export function reactiveRender(render: () => JSX.Element): JSX.Element {
  return standalone(renderReactively, render)
}

function renderReactively(render: () => JSX.Element): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(createReactState)
  const rx = state.rx
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmountEffect, [])
  return rx.jsx(render)
}

class Rx extends Stateful {
  @cached
  jsx(render: () => JSX.Element): JSX.Element {
    return render()
  }

  @trigger
  keepFresh(): void {
    if (cacheof(this.jsx).invalid)
      this.refresh({rx: this})
  }

  @stateless refresh: (next: ReactState) => void = nop
  @stateless readonly unmountEffect = (): (() => void) => {
    return () => Cache.unmount(this)
  }
}

function createReactState(): ReactState {
  return {rx: Transaction.run<Rx>("<rx>", createRx)}
}

function createRx(): Rx {
  return new Rx()
}

function nop(...args: any[]): void {
  // do nothing
}
