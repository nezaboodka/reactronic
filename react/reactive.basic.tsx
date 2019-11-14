// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react'
import { State, Action, Cache, stateless, trigger, cached, separate } from 'reactronic'

export function reactive(render: () => JSX.Element): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(createReactState)
  const rx = state.rx
  rx.counter = state.counter
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.view(render)
}

// Internal

type ReactState = { rx: Rx, counter: number }

class Rx extends State {
  @cached
  view(generate: () => JSX.Element): JSX.Element {
    return generate()
  }

  @trigger
  keepFresh(): void {
    if (Cache.of(this.view).invalid)
      separate(this.refresh, {rx: this, counter: this.counter + 1})
  }

  @stateless counter: number = 0
  @stateless refresh: (next: ReactState) => void = nop
  @stateless readonly unmount = (): (() => void) => {
    return (): void => { separate(Cache.unmount, this) }
  }
}

function createReactState<V>(): ReactState {
  const rx = Action.runAs<Rx>('<rx>', false, undefined, undefined, createRx)
  return {rx, counter: 0}
}

function createRx<V>(): Rx {
  return new Rx()
}

function nop(...args: any[]): void {
  // do nothing
}
