// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from "react"
import { ObservableObject, Transaction, observable, runAtomically, reactive, cached, ReactiveSystem, LoggingOptions, manageReactiveOperation, disposeObservableObject } from "../source/api.js"

export function autorender(render: (cycle: number) => React.JSX.Element, name?: string, logging?: Partial<LoggingOptions>, op?: Transaction): React.JSX.Element {
  const [state, refresh] = React.useState<ReactState<React.JSX.Element>>(
    (!name && !logging) ? createReactState : () => createReactState(name, logging))
  const rx = state.rx
  rx.cycle = state.cycle
  rx.refresh = refresh // just in case React will change refresh on each rendering
  React.useEffect(rx.unmount, [])
  return rx.render(render, op)
}

// Internal

type ReactState<V> = { rx: RxComponent<V>, cycle: number }

class RxComponent<V> extends ObservableObject {
  @cached
  render(emit: (cycle: number) => V, op?: Transaction): V {
    return op ? op.inspect(() => emit(this.cycle)) : emit(this.cycle)
  }

  @reactive
  protected ensureUpToDate(): void {
    if (!manageReactiveOperation(this.render).isReusable)
      Transaction.outside(this.refresh, {rx: this, cycle: this.cycle + 1})
  }

  @observable(false) cycle: number = 0

  @observable(false) refresh: (next: ReactState<V>) => void = nop

  @observable(false) readonly unmount = (): (() => void) => {
    return (): void => { runAtomically(disposeObservableObject, this) }
  }

  static create<V>(hint: string | undefined, logging: LoggingOptions | undefined): RxComponent<V> {
    const rx = new RxComponent<V>()
    if (hint)
      ReactiveSystem.setLoggingHint(rx, hint)
    if (logging) {
      manageReactiveOperation(rx.render).configure({ logging })
      manageReactiveOperation(rx.ensureUpToDate).configure({ logging })
    }
    return rx
  }
}

function createReactState<V>(name?: string, logging?: Partial<LoggingOptions>): ReactState<V> {
  const hint = name || (ReactiveSystem.isLogging ? getComponentName() : "<rx>")
  const rx = runAtomically<RxComponent<V>>({ hint, logging }, RxComponent.create, hint, logging)
  return {rx, cycle: 0}
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
  const i = lines.findIndex(x => x.indexOf(reactive.name) >= 0) || 6
  let result: string = lines[i + 1] || ""
  result = (result.match(/^\s*at\s*(\S+)/) || [])[1]
  return result !== undefined ? `<${result}>` : "<Rx>"
}
