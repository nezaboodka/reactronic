// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

export interface Worker {
  readonly id: number
  readonly hint: string
  readonly isCanceled: boolean
  readonly isFinished: boolean
  cancel(error: Error, restartAfter?: Worker | null): this
  whenFinished(): Promise<void>
}
