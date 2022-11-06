// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Collection, Item, CollectionReader } from '../util/Collection'
import { ObservableObject } from './Mvcc'

// ObservableCollection

export abstract class ObservableCollection<T> extends ObservableObject implements CollectionReader<T> {
  protected abstract impl: Collection<T>
  get strict(): boolean { return this.impl.strict }
  get count(): number { return this.impl.count }
  get addedCount(): number { return this.impl.addedCount }
  get removedCount(): number { return this.impl.removedCount }
  get isMergeInProgress(): boolean { return this.impl.isMergeInProgress }

  lookup(key: string): Item<T> | undefined { return this.impl.lookup(key) }
  claim(key: string): Item<T> | undefined { return this.impl.claim(key) }
  add(instance: T): Item<T> { return this.impl.add(instance) }
  remove(item: Item<T>): void { return this.impl.remove(item) }
  move(item: Item<T>, after: Item<T>): void { this.impl.move(item, after) }
  beginMerge(): void { this.impl.beginMerge() }
  endMerge(error?: unknown): void { this.impl.endMerge(error) }
  resetAddedAndRemovedLists(): void { this.impl.resetAddedAndRemovedLists() }
  lastClaimedItem(): Item<T> | undefined { return this.impl.lastClaimedItem() }

  items(): Generator<Item<T>> { return this.impl.items() }
  addedItems(reset?: boolean): Generator<Item<T>> { return this.impl.addedItems(reset) }
  removedItems(reset?: boolean): Generator<Item<T>> { return this.impl.removedItems(reset) }
  isAdded(item: Item<T>): boolean { return this.impl.isAdded(item) }
  isMoved(item: Item<T>): boolean { return this.impl.isMoved(item) }
  isRemoved(item: Item<T>): boolean { return this.impl.isRemoved(item) }
  isCurrent(item: Item<T>): boolean { return this.impl.isCurrent(item) }
}
