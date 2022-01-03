﻿// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { ObservableObject, Transaction, Rx, reaction } from '../source/api'
import { TestingTraceLevel } from './brief'

export class ReactiveDemo extends ObservableObject {
  title: string = 'ReactiveDemo'
  content: string = 'Content'

  @reaction
  actualize1(): void {
    this.title
    this.title = 'Title/1'
    this.content = 'Content/1'
    this.title
  }

  @reaction
  actualize2(): void {
    this.content
    this.title = 'Title/2'
  }
}

test('reactive', t => {
  Rx.setTraceMode(true, TestingTraceLevel)
  const demo = Transaction.run(null, () => new ReactiveDemo())
  t.is(demo.title, 'Title/2')
  t.is(demo.content, 'Content/1')
})
