// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from 'react'
import { Stateful, Transaction, stateless, trigger, cached, isolated, Reactronic } from 'api' // from 'reactronic'

export function reactive(render: () => JSX.Element): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(createReactState)
  const rx = state.rx
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.render(render)
}

// Internal

type ReactState = { rx: Rx }

class Rx extends Stateful {
  @cached
  render(render: () => JSX.Element): JSX.Element {
    return render()
  }

  @trigger
  protected pulse(): void {
    if (Reactronic.getMethodCacheOf(this.render).invalid)
      isolated(this.refresh, {rx: this})
  }

  @stateless refresh: (next: ReactState) => void = nop
  @stateless readonly unmount = (): (() => void) => {
    return (): void => { isolated(Reactronic.unmount, this) }
  }

  static create<V>(): Rx {
    return new Rx()
  }
}

function createReactState(): ReactState {
  const rx = Transaction.runAs<Rx>({ hint: '<rx>' }, Rx.create)
  return {rx}
}

function nop(...args: any[]): void {
  // do nothing
}
