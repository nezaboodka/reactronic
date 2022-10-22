// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

/* istanbul ignore file */

import { ObservableObject } from './impl/Mvcc'

export abstract class Buffer<T> extends ObservableObject {
  abstract readonly capacity: number
  abstract readonly count: number
  abstract put(...items: T[]): void
  abstract take(count: number): T[]
  // To be continued...

  static create<T>(hint?: string, capacity?: number): Buffer<T> { throw new Error('not implemented') }
}
