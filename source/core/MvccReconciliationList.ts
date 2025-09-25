// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { ReconciliationList, LinkedItem, ReconciliationListReader } from "../util/ReconciliationList.js"
import { ObservableObject } from "./Mvcc.js"

// ObservableReconciliationList

export abstract class ObservableReconciliationList<T> extends ObservableObject implements ReconciliationListReader<T> {
  protected abstract impl: ReconciliationList<T>
  get isStrict(): boolean { return this.impl.isStrict }
  get count(): number { return this.impl.count }
  get countOfAdded(): number { return this.impl.countOfAdded }
  get countOfRemoved(): number { return this.impl.countOfRemoved }
  get isReconciliationInProgress(): boolean { return this.impl.isReconciliationInProgress }

  lookup(key: string): LinkedItem<T> | undefined { return this.impl.lookup(key) }
  tryReuse(key: string): LinkedItem<T> | undefined { return this.impl.tryReuse(key) }
  add(instance: T): LinkedItem<T> { return this.impl.add(instance) }
  remove(item: LinkedItem<T>): void { return this.impl.remove(item) }
  move(item: LinkedItem<T>, after: LinkedItem<T>): void { this.impl.move(item, after) }
  beginReconciliation(): void { this.impl.beginReconciliation() }
  endReconciliation(error?: unknown): void { this.impl.endReconciliation(error) }
  clearAddedAndRemovedLists(): void { this.impl.clearAddedAndRemoved() }
  firstItem(): LinkedItem<T> | undefined { return this.impl.firstItem() }
  lastItem(): LinkedItem<T> | undefined { return this.impl.lastItem() }

  items(): Generator<LinkedItem<T>> { return this.impl.items() }
  itemsAdded(clear?: boolean): Generator<LinkedItem<T>> { return this.impl.itemsAdded(clear) }
  itemsRemoved(clear?: boolean): Generator<LinkedItem<T>> { return this.impl.itemsRemoved(clear) }
  isAdded(item: LinkedItem<T>): boolean { return this.impl.isAdded(item) }
  isMoved(item: LinkedItem<T>): boolean { return this.impl.isMoved(item) }
  isRemoved(item: LinkedItem<T>): boolean { return this.impl.isRemoved(item) }
  isFresh(item: LinkedItem<T>): boolean { return this.impl.isFresh(item) }
  isExternal(item: LinkedItem<T>): boolean { return this.impl.isExternal(item) }
}
