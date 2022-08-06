// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Collection, Item, CollectionReader } from '../util/Collection'
import { ReactiveObject } from './Mvcc'

// ReactiveCollection

export abstract class ReactiveCollection<T> extends ReactiveObject implements CollectionReader<T> {
  protected abstract a: Collection<T>
  get strict(): boolean { return this.a.strict }
  get count(): number { return this.a.count }
  get addedCount(): number { return this.a.addedCount }
  get removedCount(): number { return this.a.removedCount }
  get isMergeInProgress(): boolean { return this.a.isMergeInProgress }

  lookup(key: string): Item<T> | undefined { return this.a.lookup(key) }
  claim(key: string): Item<T> | undefined { return this.a.claim(key) }
  add(self: T): Item<T> { return this.a.add(self) }
  remove(item: Item<T>): void { return this.a.remove(item) }
  move(item: Item<T>, after: Item<T>): void { this.a.move(item, after) }
  beginMerge(): void { this.a.beginMerge() }
  endMerge(error?: unknown): void { this.a.endMerge(error) }
  resetAddedAndRemovedLists(): void { this.a.resetAddedAndRemovedLists() }

  items(): Generator<Item<T>> { return this.a.items() }
  addedItems(reset?: boolean): Generator<Item<T>> { return this.a.addedItems(reset) }
  removedItems(reset?: boolean): Generator<Item<T>> { return this.a.removedItems(reset) }
  isAdded(item: Item<T>): boolean { return this.a.isAdded(item) }
  isMoved(item: Item<T>): boolean { return this.a.isMoved(item) }
  isRemoved(item: Item<T>): boolean { return this.a.isRemoved(item) }
  isCurrent(item: Item<T>): boolean { return this.a.isCurrent(item) }
}
