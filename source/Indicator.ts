// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Stateful, IndicatorImpl } from './impl/.index'
import { Action } from './Action'

export abstract class Indicator extends Stateful {
  abstract readonly busy: boolean
  abstract readonly counter: number
  abstract readonly actions: ReadonlySet<Action>
  abstract readonly frameCount: number
  abstract readonly prolonged?: number // milliseconds

  abstract enter(action: Action): void
  abstract leave(action: Action): void

  static create(hint?: string, prolonged?: number): Indicator { return IndicatorImpl.create(hint, prolonged) }
}
