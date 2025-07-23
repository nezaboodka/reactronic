// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from "react"
import { runAtomically, reactive, cached, Transaction, ReactiveSystem } from "../source/api.js"

export class Component<P> extends React.Component<P> {
  @cached
  override render(): React.JSX.Element {
    throw new Error("render method is undefined")
  }

  @reactive // called immediately in response to changes
  ensureUpToDate(): void {
    if (this.shouldComponentUpdate())
      Transaction.outside(() => this.setState({})) // ask React to re-render
  } // ensureUpToDate is subscribed to render

  override shouldComponentUpdate(): boolean {
    return !ReactiveSystem.getDescriptor(this.render).isReusable
  }

  override componentDidMount(): void {
    this.ensureUpToDate() // run to subscribe for the first time
  }

  override componentWillUnmount(): void {
    runAtomically(ReactiveSystem.dispose, this)
  }
}
