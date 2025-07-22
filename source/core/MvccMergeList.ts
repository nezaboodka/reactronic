// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { MergeList, MergedItem, MergeListReader } from "../util/MergeList.js"
import { ObservableObject } from "./Mvcc.js"

// ObservableMergeList

export abstract class ObservableMergeList<T> extends ObservableObject implements MergeListReader<T> {
  protected abstract impl: MergeList<T>
  get isStrict(): boolean { return this.impl.isStrict }
  get count(): number { return this.impl.count }
  get addedCount(): number { return this.impl.addedCount }
  get removedCount(): number { return this.impl.removedCount }
  get isMergeInProgress(): boolean { return this.impl.isMergeInProgress }

  lookup(key: string): MergedItem<T> | undefined { return this.impl.lookup(key) }
  tryMergeAsExisting(key: string): MergedItem<T> | undefined { return this.impl.tryMergeAsExisting(key) }
  mergeAsAdded(instance: T): MergedItem<T> { return this.impl.mergeAsAdded(instance) }
  mergeAsRemoved(item: MergedItem<T>): void { return this.impl.mergeAsRemoved(item) }
  move(item: MergedItem<T>, after: MergedItem<T>): void { this.impl.move(item, after) }
  beginMerge(): void { this.impl.beginMerge() }
  endMerge(error?: unknown): void { this.impl.endMerge(error) }
  resetAddedAndRemovedLists(): void { this.impl.resetAddedAndRemovedLists() }
  firstMergedItem(): MergedItem<T> | undefined { return this.impl.firstMergedItem() }
  lastMergedItem(): MergedItem<T> | undefined { return this.impl.lastMergedItem() }

  items(): Generator<MergedItem<T>> { return this.impl.items() }
  addedItems(reset?: boolean): Generator<MergedItem<T>> { return this.impl.addedItems(reset) }
  removedItems(reset?: boolean): Generator<MergedItem<T>> { return this.impl.removedItems(reset) }
  isAdded(item: MergedItem<T>): boolean { return this.impl.isAdded(item) }
  isMoved(item: MergedItem<T>): boolean { return this.impl.isMoved(item) }
  isRemoved(item: MergedItem<T>): boolean { return this.impl.isRemoved(item) }
  isActual(item: MergedItem<T>): boolean { return this.impl.isActual(item) }
}
