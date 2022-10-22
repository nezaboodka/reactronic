// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from 'react'
import { ObservableObject, transactional, cached } from '../source/api'
import { Component } from './Component'

class MyModel extends ObservableObject {
  url: string = 'https://nezaboodka.com'
  content: string = ''
  timestamp: number = Date.now()

  @transactional
  async goto(url: string): Promise<void> {
    this.url = url
    this.content = await (await fetch(url)).text()
    this.timestamp = Date.now()
  }
}

class MyView extends Component<{model: MyModel}> {
  @cached
  render(): JSX.Element {
    const m = this.props.model
    return (
      <div>
        <div>{m.url}</div>
        <div>{m.content}</div>
      </div>)
  }
}

export const dummy = MyView
