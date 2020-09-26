// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { F } from './util/Utils'
import { SnapshotOptions } from './Options'
import { TransactionImpl } from './impl/TransactionImpl'
import { Worker } from './Monitor'

export abstract class Transaction implements Worker {
  static get current(): Transaction { return TransactionImpl.current }

  abstract readonly id: number
  abstract readonly hint: string
  abstract readonly options: SnapshotOptions
  abstract readonly timestamp: number
  abstract readonly error: Error | undefined

  abstract run<T>(func: F<T>, ...args: any[]): T
  abstract inspect<T>(func: F<T>, ...args: any[]): T
  abstract apply(): void
  abstract seal(): this
  abstract bind<T>(func: F<T>, secondary: boolean): F<T>
  abstract cancel(error: Error, retryAfterOrIgnore?: Worker | null): this
  abstract readonly isCanceled: boolean
  abstract readonly isFinished: boolean
  abstract async whenFinished(): Promise<void>
  abstract revert(): Transaction

  static create(options: SnapshotOptions | null): Transaction { return new TransactionImpl(options) }
  static run<T>(func: F<T>, ...args: any[]): T { return TransactionImpl.run<T>(func, ...args) }
  static runAs<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T { return TransactionImpl.runAs<T>(options, func, ...args) }
  static isolated<T>(func: F<T>, ...args: any[]): T { return TransactionImpl.isolated<T>(func, ...args) }
}
