// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from "react"
import { ObservableObject, atomic, cache } from "../source/api.js"
import { Component } from "./Component.js"

class MyModel extends ObservableObject {
  url: string = "https://nezaboodka.com"
  content: string = ""
  timestamp: number = Date.now()

  @atomic
  async goto(url: string): Promise<void> {
    this.url = url
    this.content = await (await fetch(url)).text()
    this.timestamp = Date.now()
  }
}

class MyView extends Component<{model: MyModel}> {
  @cache
  override render(): React.JSX.Element {
    const m = this.props.model
    return (
      <div>
        <div>{m.url}</div>
        <div>{m.content}</div>
      </div>)
  }
}

export const dummy = MyView
