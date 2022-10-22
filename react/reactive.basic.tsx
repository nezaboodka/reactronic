// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from 'react'
import { ObservableObject, Transaction, raw, reactive, cached, Rx } from '../source/api'

export function autorender(render: () => JSX.Element): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(createReactState)
  const rx = state.rx
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.render(render)
}

// Internal

type ReactState = { rx: RxComponent }

class RxComponent extends ObservableObject {
  @cached
  render(emit: () => JSX.Element): JSX.Element {
    return emit()
  }

  @reactive
  protected ensureUpToDate(): void {
    if (!Rx.getController(this.render).isUpToDate)
      Transaction.outside(this.refresh, {rx: this})
  }

  @raw refresh: (next: ReactState) => void = nop
  @raw readonly unmount = (): (() => void) => {
    return (): void => { Transaction.run(null, Rx.dispose, this) }
  }

  static create(): RxComponent {
    return new RxComponent()
  }
}

function createReactState(): ReactState {
  const rx = Transaction.run<RxComponent>({ hint: '<rx>' }, RxComponent.create)
  return {rx}
}

function nop(...args: any[]): void {
  // do nothing
}
