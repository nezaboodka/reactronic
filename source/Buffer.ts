// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Stateful } from './impl/Hooks'

export abstract class Buffer<T> extends Stateful {
  abstract readonly capacity: number
  abstract readonly count: number
  abstract put(...items: T[]): void
  abstract take(count: number): T[]
  // To be continued...

  static create<T>(hint?: string, capacity?: number): Buffer<T> { throw new Error('not implemented') }
}
