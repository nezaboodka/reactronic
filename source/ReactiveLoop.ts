// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { F } from "./util/Utils.js"
import { ObservableObject } from "./core/Mvcc.js"
import { reactive } from "./ReactiveSystem.js"


export class ReactiveLoop<T> extends ObservableObject
{
  constructor(protected reactiveFunction: F<T>) {
    super()
  }

  @reactive
  protected launch(): T {
    return this.reactiveFunction()
  }
}
