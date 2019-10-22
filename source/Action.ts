// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F } from './util/Utils'
import { Trace } from './Trace'
import { Transaction } from './impl/Transaction'
import { Worker } from './Monitor'

export abstract class Action implements Worker {
  static get current(): Action { return Transaction.current }

  abstract readonly id: number
  abstract readonly hint: string

  abstract run<T>(func: F<T>, ...args: any[]): T
  abstract inspect<T>(func: F<T>, ...args: any[]): T
  abstract apply(): void
  abstract seal(): this
  abstract bind<T>(func: F<T>, secondary: boolean): F<T>
  abstract cancel(error: Error, retryAfterOrIgnore?: Worker | null): this
  abstract readonly isCanceled: boolean
  abstract readonly isFinished: boolean
  abstract async whenFinished(): Promise<void>

  static create(hint: string): Action { return new Transaction(hint) }
  static run<T>(hint: string, func: F<T>, ...args: any[]): T { return Transaction.run<T>(hint, func, ...args) }
  static runAs<T>(hint: string, spawn: boolean, trace: Partial<Trace> | undefined, token: any, func: F<T>, ...args: any[]): T { return Transaction.runAs<T>(hint, spawn, trace, token, func, ...args) }
  static off<T>(func: F<T>, ...args: any[]): T { return Transaction.off<T>(func, ...args) }
}
