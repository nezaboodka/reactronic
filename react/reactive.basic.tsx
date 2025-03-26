// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from "react"
import { TriggeringObject, Transaction, trigger, atomicRun, reactive, cached, ReactiveSystem } from "../source/api.js"

export function autorender(render: () => React.JSX.Element): React.JSX.Element {
  const [state, refresh] = React.useState<ReactState>(createReactState)
  const rx = state.rx
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.render(render)
}

// Internal

type ReactState = { rx: RxComponent }

class RxComponent extends TriggeringObject {
  @cached
  render(emit: () => React.JSX.Element): React.JSX.Element {
    return emit()
  }

  @reactive
  protected ensureUpToDate(): void {
    if (!ReactiveSystem.getOperation(this.render).isReusable)
      Transaction.outside(this.refresh, {rx: this})
  }

  @trigger(false) refresh: (next: ReactState) => void = nop
  @trigger(false) readonly unmount = (): (() => void) => {
    return (): void => { atomicRun(ReactiveSystem.dispose, this) }
  }

  static create(): RxComponent {
    return new RxComponent()
  }
}

function createReactState(): ReactState {
  const rx = atomicRun<RxComponent>({ hint: "<rx>" }, RxComponent.create)
  return {rx}
}

function nop(...args: any[]): void {
  // do nothing
}
