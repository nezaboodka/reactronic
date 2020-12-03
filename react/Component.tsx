// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from 'react'
import { reactive, cached, isolated, Reactronic } from 'api' // from 'reactronic'

export class Component<P> extends React.Component<P> {
  @cached
  render(): JSX.Element {
    throw new Error('render method is undefined')
  }

  @reactive
  pulse(): void {
    if (this.shouldComponentUpdate())
      isolated(() => this.setState({}))
  }

  shouldComponentUpdate(): boolean {
    return Reactronic.getMethodCache(this.render).invalid
  }

  componentDidMount(): void {
    this.pulse()
  }

  componentWillUnmount(): void {
    isolated(Reactronic.dispose, this)
  }
}
