// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2024 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

/* istanbul ignore file */

import { ObservableObject } from "./core/Mvcc.js"

export abstract class Pipe<T> extends ObservableObject {
  abstract readonly capacity: number
  abstract readonly count: number
  abstract put(...items: T[]): void
  abstract take(count: number): T[]
  // To be continued...

  static create<T>(hint?: string, capacity?: number): Pipe<T> { throw new Error("not implemented") }
}
