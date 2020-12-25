// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from 'react'
import { reaction, cached, isolatedRun, Reactronic } from 'api' // from 'reactronic'

export class Component<P> extends React.Component<P> {
  @cached
  render(): JSX.Element {
    throw new Error('render method is undefined')
  }

  @reaction
  pulse(): void {
    if (this.shouldComponentUpdate())
      isolatedRun(() => this.setState({}))
  }

  shouldComponentUpdate(): boolean {
    return Reactronic.getController(this.render).isInvalid
  }

  componentDidMount(): void {
    this.pulse()
  }

  componentWillUnmount(): void {
    isolatedRun(Reactronic.dispose, this)
  }
}
