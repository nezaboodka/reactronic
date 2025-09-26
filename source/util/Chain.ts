// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"

export type GetChainItemKey<T = unknown> = (payload: T) => string | undefined

const TAG_FACTOR = 4

export enum ChainedItemStatus {
  reused = 0,
  added = 1,
  moved = 2,
  removed = 3,
}

export type Chained<T> = {
  readonly payload: T
  readonly index: number
  readonly status: ChainedItemStatus
  readonly next?: Chained<T>
  readonly prev?: Chained<T>
}

export type ChainReader<T> = {
  readonly isStrict: boolean
  readonly isUpdateInProgress: boolean
  readonly actual: SubChainReader<T>
  readonly added: SubChainReader<T>
  readonly removed: SubChainReader<T>
  lookup(key: string): Chained<T> | undefined
}

export type SubChainReader<T> = {
  readonly count: number
  readonly first?: Chained<T>
  readonly last?: Chained<T>
}

// Chain / Цепочка

export class Chain<T> implements ChainReader<T> {
  readonly getKey: GetChainItemKey<T>
  private isStrict$: boolean
  private map: Map<string | undefined, Chained$<T>>
  private tag: number
  private actual$: SubChain<T>
  private added$: AuxSubChain<T>
  private removed$: SubChain<T>
  private lastNotFoundKey: string | undefined
  private expectedNextItem?: Chained$<T>

  constructor(getKey: GetChainItemKey<T>, isStrict: boolean = false) {
    this.getKey = getKey
    this.isStrict$ = isStrict
    this.map = new Map<string | undefined, Chained$<T>>()
    this.tag = ~1
    this.actual$ = new SubChain<T>()
    this.added$ = new AuxSubChain<T>()
    this.removed$ = new SubChain<T>()
    this.lastNotFoundKey = undefined
    this.expectedNextItem = undefined
  }

  get isStrict(): boolean { return this.isStrict$ }
  set isStrict(value: boolean) {
    if (this.isUpdateInProgress && this.actual$.count > 0)
      throw misuse("cannot change strict mode in the middle of reconciliation")
    this.isStrict$ = value
  }

  get isUpdateInProgress(): boolean {
    return this.tag > 0
  }

  get actual(): SubChainReader<T> {
    return this.actual$
  }

  get added(): SubChainReader<T> {
    return this.added$
  }

  get removed(): SubChainReader<T> {
    return this.removed$
  }

  lookup(key: string | undefined): Chained<T> | undefined {
    let result: Chained<T> | undefined = undefined
    if (key !== undefined && key !== this.lastNotFoundKey) {
      result = this.map.get(key)
      if (result) {
        if (this.getKey(result.payload) !== key) {
          this.lastNotFoundKey = key
          result = undefined
        }
      }
      else
        this.lastNotFoundKey = key
    }
    return result
  }

  tryReuse(key: string, resolution?: { isDuplicate: boolean }, error?: string): Chained<T> | undefined {
    const tag = this.tag
    if (tag < 0)
      throw misuse(error ?? "update is not in progress")
    let item = this.expectedNextItem
    if (key !== (item ? this.getKey(item.payload) : undefined))
      item = this.lookup(key) as Chained$<T> | undefined
    if (item) {
      if (!this.tagMatchesTo(item)) {
        if (this.isStrict$ && item !== this.expectedNextItem)
          this.setChainedItemStatus(item, ChainedItemStatus.moved)
        else
          this.setChainedItemStatus(item, ChainedItemStatus.reused)
        this.expectedNextItem = this.removed$.getActualNextOf(item)
        this.removed$.exclude(item)
        item.index = this.actual$.count
        this.actual$.include(item)
        if (resolution)
          resolution.isDuplicate = false
      }
      else if (resolution)
        resolution.isDuplicate = true
      else
        throw misuse(`duplicate collection item: ${key}`)
    }
    else if (resolution)
      resolution.isDuplicate = false
    return item
  }

  add(instance: T): Chained<T> {
    const key = this.getKey(instance)
    if (this.lookup(key) !== undefined)
      throw misuse(`key is already in use: ${key}`)
    const tag = this.tag > 0 ? this.tag : 0
    const item = new Chained$<T>(instance, tag)
    this.map.set(key, item)
    this.lastNotFoundKey = undefined
    this.expectedNextItem = undefined
    item.index = this.actual$.count
    this.actual$.include(item)
    if (tag !== 0) // if not external
      this.added$.include(item)
    return item
  }

  remove(item: Chained<T>): void {
    if (item.status !== ChainedItemStatus.removed) {
      const x = item as Chained$<T>
      this.actual$.exclude(x)
      this.removed$.include(x)
      this.setChainedItemStatus(x, ChainedItemStatus.removed)
    }
  }

  move(item: Chained<T>, after: Chained<T>): void {
    throw misuse("not implemented")
  }

  markAsMoved(item: Chained<T>): void {
    const x = item as Chained$<T>
    this.setChainedItemStatus(x, ChainedItemStatus.moved)
  }

  beginUpdate(): void {
    if (this.isUpdateInProgress)
      throw misuse("update is in progress already")
    this.tag = ~this.tag + 1
    this.expectedNextItem = this.actual$.first
    this.removed$.grabFrom(this.actual$, false)
    this.added$.clear()
  }

  endUpdate(error?: unknown): void {
    if (!this.isUpdateInProgress)
      throw misuse("update is ended already")
    this.tag = ~this.tag
    if (error === undefined) {
      const actualCount = this.actual$.count
      if (actualCount > 0) {
        const getKey = this.getKey
        if (actualCount > this.removed$.count) { // it should be faster to delete vanished items
          const map = this.map
          for (const x of this.removed$.items())
            map.delete(getKey(x.payload))
        }
        else { // it should be faster to recreate map using actual items
          const map = this.map = new Map<string | undefined, Chained$<T>>()
          for (const x of this.actual$.items())
            map.set(getKey(x.payload), x)
        }
      }
      else // just create new empty map
        this.map = new Map<string | undefined, Chained$<T>>()
    }
    else {
      this.actual$.grabFrom(this.removed$, true)
      const getKey = this.getKey
      for (const x of this.added$.items()) {
        this.map.delete(getKey(x.payload))
        this.actual$.exclude(x)
      }
      this.added$.clear()
    }
  }

  clearAddedAndRemoved(): void {
    this.added$.clear()
    this.removed$.clear()
  }

  static createItem<T>(instance: T): Chained<T> {
    return new Chained$<T>(instance, 0)
  }

  // Internal

  private tagMatchesTo(item: Chained$<T>): boolean {
    return Math.trunc(item.tag / TAG_FACTOR) === this.tag
  }

  private setChainedItemStatus(item: Chained$<T>, status: ChainedItemStatus): void {
    const tag = this.tag > 0 ? this.tag : ~this.tag
    item.tag = tag * TAG_FACTOR + status
  }
}

// Chained$

class Chained$<T> implements Chained<T> {
  readonly payload: T
  index: number
  tag: number
  next?: Chained$<T>
  prev?: Chained$<T>
  aux?: Chained$<T>

  constructor(instance: T, tag: number) {
    this.payload = instance
    this.index = -1
    this.tag = tag
    this.next = undefined
    this.prev = undefined
    this.aux = undefined
  }

  get status(): ChainedItemStatus {
    return this.tag % TAG_FACTOR
  }
}

// AbstractSubChain

abstract class AbstractSubChain<T> implements SubChainReader<T> {
  count: number = 0
  first?: Chained$<T> = undefined
  last?: Chained$<T> = undefined

  abstract getActualNextOf(item: Chained$<T>): Chained$<T> | undefined
  abstract setActualNextOf(item: Chained$<T>, next: Chained$<T> | undefined): Chained$<T> | undefined
  abstract getActualPrevOf(item: Chained$<T>): Chained$<T> | undefined
  abstract setActualPrevOf(item: Chained$<T>, prev: Chained$<T> | undefined): Chained$<T> | undefined

  *items(): Generator<Chained$<T>> {
    let x = this.first
    while (x !== undefined) {
      const next = this.getActualNextOf(x)
      yield x
      x = next
    }
  }

  include(item: Chained$<T>): void {
    const last = this.last
    this.setActualPrevOf(item, last)
    this.setActualNextOf(item, undefined)
    if (last)
      this.last = this.setActualNextOf(last, item)
    else
      this.first = this.last = item
    this.count++
  }

  exclude(item: Chained$<T>): void {
    const prev = this.getActualPrevOf(item)
    if (prev !== undefined)
      this.setActualNextOf(prev, this.getActualNextOf(item))
    const next = this.getActualNextOf(item)
    if (next !== undefined)
      this.setActualPrevOf(next, this.getActualPrevOf(item))
    if (item === this.first)
      this.first = this.getActualNextOf(item)
    this.count--
  }

  clear(): void {
    this.count = 0
    this.first = undefined
    this.last = undefined
  }
}

// SubChain

class SubChain<T> extends AbstractSubChain<T> {
  override getActualNextOf(item: Chained$<T>): Chained$<T> | undefined {
    return item.next
  }

  override setActualNextOf(item: Chained$<T>, next: Chained$<T> | undefined): Chained$<T> | undefined {
    item.next = next
    return next
  }

  override getActualPrevOf(item: Chained$<T>): Chained$<T> | undefined {
    return item.prev
  }

  override setActualPrevOf(item: Chained$<T>, prev: Chained$<T> | undefined): Chained$<T> | undefined {
    item.prev = prev
    return prev
  }

  grabFrom(from: SubChain<T>, join: boolean): void {
    const head = from.first
    if (join && head) {
      const last = this.last
      this.setActualPrevOf(head, last)
      if (last)
        this.last = this.setActualNextOf(last, head)
      else
        this.first = this.last = head
      this.count += from.count
    }
    else {
      this.count = from.count
      this.first = head
      this.last = from.last
    }
    from.clear()
  }
}

// AuxSubChain

class AuxSubChain<T> extends AbstractSubChain<T> {
  override getActualNextOf(item: Chained$<T>): Chained$<T> | undefined {
    return item.aux
  }

  override setActualNextOf(item: Chained$<T>, next: Chained$<T> | undefined): Chained$<T> | undefined {
    item.aux = next
    return next
  }

  override getActualPrevOf(item: Chained$<T>): Chained$<T> | undefined {
    throw misuse("aux sub chain is not two-way linked")
  }

  override setActualPrevOf(item: Chained$<T>, prev: Chained$<T> | undefined): Chained$<T> | undefined {
    throw misuse("aux sub chain is not two-way linked")
  }
}
