// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2023 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { MergeList, MergeItem, MergeListReader } from '../util/MergeList.js'
import { ObservableObject } from './Mvcc.js'

// ObservableMergeList

export abstract class ObservableMergeList<T> extends ObservableObject implements MergeListReader<T> {
  protected abstract impl: MergeList<T>
  get isStrict(): boolean { return this.impl.isStrict }
  get count(): number { return this.impl.count }
  get addedCount(): number { return this.impl.addedCount }
  get removedCount(): number { return this.impl.removedCount }
  get isMergeInProgress(): boolean { return this.impl.isMergeInProgress }

  lookup(key: string): MergeItem<T> | undefined { return this.impl.lookup(key) }
  claim(key: string): MergeItem<T> | undefined { return this.impl.claim(key) }
  add(instance: T): MergeItem<T> { return this.impl.add(instance) }
  remove(item: MergeItem<T>): void { return this.impl.remove(item) }
  move(item: MergeItem<T>, after: MergeItem<T>): void { this.impl.move(item, after) }
  beginMerge(): void { this.impl.beginMerge() }
  endMerge(error?: unknown): void { this.impl.endMerge(error) }
  resetAddedAndRemovedLists(): void { this.impl.resetAddedAndRemovedLists() }
  lastClaimedItem(): MergeItem<T> | undefined { return this.impl.lastClaimedItem() }

  items(): Generator<MergeItem<T>> { return this.impl.items() }
  addedItems(reset?: boolean): Generator<MergeItem<T>> { return this.impl.addedItems(reset) }
  removedItems(reset?: boolean): Generator<MergeItem<T>> { return this.impl.removedItems(reset) }
  isAdded(item: MergeItem<T>): boolean { return this.impl.isAdded(item) }
  isMoved(item: MergeItem<T>): boolean { return this.impl.isMoved(item) }
  isRemoved(item: MergeItem<T>): boolean { return this.impl.isRemoved(item) }
  isCurrent(item: MergeItem<T>): boolean { return this.impl.isCurrent(item) }
}
