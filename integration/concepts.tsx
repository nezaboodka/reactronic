// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react'
import { Stateful, action, cached, trigger, cacheof } from '.index'

class Model extends Stateful {
  // state
  url: string = "https://nezaboodka.com"
  content: string = ""
  timestamp: number = Date.now()

  @action
  async goto(url: string): Promise<void> {
    this.url = url
    this.content = await (await fetch(url)).text()
    this.timestamp = Date.now()
  }
}

class View extends React.Component<Model> {
  @trigger
  keepFresh(): void {
    if (cacheof(this.render).invalid)
      this.setState({}) // ask React
  }

  @cached
  render(): JSX.Element {
    return (
      <div>
        <div>{this.props.url}</div>
        <div>{this.props.content}</div>
      </div>)
  }
}

export const dummy = View
