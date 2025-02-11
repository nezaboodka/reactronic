// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { ObservableObject, ReactiveSystem, reaction, impact, unobservable, transaction, nonreactive } from "../source/api.js"
import { TestsLoggingLevel } from "./brief.js"

export class ReactiveDemo extends ObservableObject {
  title: string = "ReactiveDemo"
  titleNested: string = "Abc"
  content: string = "Content"
  data: string = "Data"
  @unobservable rev: number = 0

  @impact
  setData(value: string): void {
    this.data =  value
  }

  @reaction
  protected actualize1(): void {
    this.title
    this.title = "Title/1"
    this.content = "Content/1"
    this.title
    nonreactive(() => {
      this.nestedReaction()
    })
  }

  @reaction
  protected actualize2(): void {
    this.content
    this.title = "Title/2"
  }

  @reaction
  protected reactOnAnyChange(): void {
    this.rev = ReactiveSystem.getRevisionOf(this)
  }

  @reaction
  protected nestedReaction(): void {
    this.content
    this.title = "Title/Nested"
    this.titleNested = "Def"
    // this.title
  }
}

test("reactive", t => {
  ReactiveSystem.setLoggingMode(true, TestsLoggingLevel)
  const demo = transaction(() => new ReactiveDemo())
  t.is(demo.title, "Title/1")
  t.is(demo.content, "Content/1")
  t.is(demo.rev, 6)
  demo.setData("Hello")
  t.is(demo.rev, 10)
  t.is(ReactiveSystem.getRevisionOf(demo), 10)
})
