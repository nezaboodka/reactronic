// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react'
import { State, Action, Cache, stateless, trigger, cached, isolated } from 'reactronic'

export function reactive(render: () => JSX.Element): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(createReactState)
  const rx = state.rx
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.render(render)
}

// Internal

type ReactState = { rx: Rx }

class Rx extends State {
  @cached
  render(render: () => JSX.Element): JSX.Element {
    return render()
  }

  @trigger
  pulse(): void {
    if (Cache.of(this.render).invalid)
      isolated(this.refresh, {rx: this})
  }

  @stateless refresh: (next: ReactState) => void = nop
  @stateless readonly unmount = (): (() => void) => {
    return (): void => { isolated(Cache.unmount, this) }
  }
}

function createReactState<V>(): ReactState {
  const rx = Action.runAs<Rx>('<rx>', false, undefined, undefined, createRx)
  return {rx}
}

function createRx<V>(): Rx {
  return new Rx()
}

function nop(...args: any[]): void {
  // do nothing
}
