// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { ObservableObject, Transaction, Rx, reactive, transactional, raw } from '../source/api'
import { TestsLoggingLevel } from './brief'

export class ReactiveDemo extends ObservableObject {
  title: string = 'ReactiveDemo'
  content: string = 'Content'
  data: string = 'Data'
  @raw rev: number = 0

  @transactional
  setData(value: string): void {
    this.data =  value
  }

  @reactive
  protected actualize1(): void {
    this.title
    this.title = 'Title/1'
    this.content = 'Content/1'
    this.title
  }

  @reactive
  protected actualize2(): void {
    this.content
    this.title = 'Title/2'
  }

  @reactive
  protected reactOnAnyChange(): void {
    this.rev = Rx.getRevisionOf(this)
  }
}

test('reactive', t => {
  Rx.setLoggingMode(true, TestsLoggingLevel)
  const demo = Transaction.run(null, () => new ReactiveDemo())
  t.is(demo.title, 'Title/1')
  t.is(demo.content, 'Content/1')
  t.is(demo.rev, 6)
  demo.setData('Hello')
  t.is(demo.rev, 10)
  t.is(Rx.getRevisionOf(demo), 10)
})
