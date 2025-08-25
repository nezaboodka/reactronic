// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

export enum Mode {
  default = 0,
  autonomous = 1,
  external = 2,
}

export enum Priority {
  realtime = 0,
  normal = 1,
  background = 2
}

export enum Kind {
  plain = 0,
  atomic = 1,
  reactive = 2,
  cached = 3,
}

export enum Reentrance {
  preventWithError = 1, // fail with error if there is an existing call in progress (default)
  waitAndRestart = 0, // wait for existing call to finish and then restart reentrant one
  cancelPrevious = -1, // cancel previous call in favor of recent one
  cancelAndWaitPrevious = -2, // cancel previous call in favor of recent one (but wait until canceling is completed)
  overwritePrevious = -3, // allow previous to complete, but overwrite it with ignoring any conflicts
  runSideBySide = -4, // multiple simultaneous operations are allowed
}

export enum Isolation {
  joinToCurrentTransaction = 0,
  joinAsNestedTransaction = 1,
  disjoinFromOuterTransaction = 2,
  disjoinFromOuterAndInnerTransactions = 3,
  disjoinForInternalDisposal = 4,
}
