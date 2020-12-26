// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from 'react'
import { ObservableObject, Transaction, unobservable, reaction, cached, isolatedRun, Reactronic } from 'api' // from 'reactronic'

export function autorender(render: () => JSX.Element): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(createReactState)
  const rx = state.rx
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.render(render)
}

// Internal

type ReactState = { rx: Rx }

class Rx extends ObservableObject {
  @cached
  render(render: () => JSX.Element): JSX.Element {
    return render()
  }

  @reaction
  protected pulse(): void {
    if (!Reactronic.getController(this.render).isValid)
      isolatedRun(this.refresh, {rx: this})
  }

  @unobservable refresh: (next: ReactState) => void = nop
  @unobservable readonly unmount = (): (() => void) => {
    return (): void => { isolatedRun(Reactronic.dispose, this) }
  }

  static create(): Rx {
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
