// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react'
import { State, Action, Cache, stateless, trigger, cached, separate } from '.index'

type ReactState = { rx: Rx }

export function reactiveRender(render: () => JSX.Element): JSX.Element {
  return separate(renderReactively, render)
}

function renderReactively(render: () => JSX.Element): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(createReactState)
  const rx = state.rx
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmountEffect, [])
  return rx.jsx(render)
}

class Rx extends State {
  @cached
  jsx(render: () => JSX.Element): JSX.Element {
    return render()
  }

  @trigger
  keepFresh(): void {
    if (Cache.of(this.jsx).invalid)
      separate(this.refresh, {rx: this})
  }

  @stateless refresh: (next: ReactState) => void = nop
  @stateless readonly unmountEffect = (): (() => void) => {
    return () => separate(Cache.unmount, this)
  }
}

function createReactState(): ReactState {
  return {rx: Action.run<Rx>('<rx>', createRx)}
}

function createRx(): Rx {
  return new Rx()
}

function nop(...args: any[]): void {
  // do nothing
}
