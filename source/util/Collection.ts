// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

export type GetItemKey<T = unknown> = (item: T) => string | undefined

export interface CollectionReader<T> {
  // readonly getKey: GetKey<T>
  readonly strict: boolean
  readonly count: number
  readonly addedCount: number
  readonly removedCount: number
  readonly isMergeInProgress: boolean

  lookup(key: string): Item<T> | undefined
  claim(key: string): Item<T> | undefined
  add(instance: T): Item<T>
  remove(item: Item<T>): void
  move(item: Item<T>, after: Item<T>): void
  beginMerge(): void
  endMerge(error?: unknown): void
  resetAddedAndRemovedLists(): void
  lastClaimedItem(): Item<T> | undefined

  items(): Generator<Item<T>>
  addedItems(reset?: boolean): Generator<Item<T>>
  removedItems(reset?: boolean): Generator<Item<T>>
  isAdded(item: Item<T>): boolean
  isMoved(item: Item<T>): boolean
  isRemoved(item: Item<T>): boolean
  isCurrent(item: Item<T>): boolean
}

export interface Item<T> {
  readonly instance: T
  // readonly next?: Item<T>
  readonly prev?: Item<T> // TODO: hide
  aux?: Item<T> // TODO: hide
}

export class Collection<T> implements CollectionReader<T> {
  readonly strict: boolean
  readonly getKey: GetItemKey<T>
  private map: Map<string | undefined, ItemImpl<T>>
  private tag: number
  private current: ItemChain<T>
  private added: ItemChain<T>
  private removed: ItemChain<T>
  private lastNotFoundKey: string | undefined
  private strictNextItem?: ItemImpl<T>

  constructor(strict: boolean, getKey: GetItemKey<T>) {
    this.strict = strict
    this.getKey = getKey
    this.map = new Map<string | undefined, ItemImpl<T>>()
    this.tag = ~0
    this.current = new ItemChain<T>()
    this.added = new ItemChain<T>()
    this.removed = new ItemChain<T>()
    this.lastNotFoundKey = undefined
    this.strictNextItem = undefined
  }

  get count(): number {
    return this.current.count
  }

  get addedCount(): number {
    return this.added.count
  }

  get removedCount(): number {
    return this.removed.count
  }

  get isMergeInProgress(): boolean {
    return this.tag > 0
  }

  lookup(key: string | undefined): Item<T> | undefined {
    let result: Item<T> | undefined = undefined
    if (key !== undefined && key !== this.lastNotFoundKey) {
      result = this.map.get(key)
      if (result) {
        if (this.getKey(result.instance) !== key) {
          this.lastNotFoundKey = key
          result = undefined
        }
      }
      else
        this.lastNotFoundKey = key
    }
    return result
  }

  claim(key: string, resolution?: { isDuplicate: boolean }, error?: string): Item<T> | undefined {
    const tag = this.tag
    if (tag < 0)
      throw new Error(error ?? 'merge is not in progress')
    let item = this.strictNextItem
    if (key !== (item ? this.getKey(item.instance) : undefined))
      item = this.lookup(key) as ItemImpl<T> | undefined
    if (item) {
      if (item.tag !== tag) {
        item.tag = tag
        if (this.strict && item !== this.strictNextItem)
          item.status = tag // IsAdded=false, IsMoved=true
        this.strictNextItem = item.next
        this.removed.exclude(item)
        this.current.include(item)
        if (resolution)
          resolution.isDuplicate = false
      }
      else if (resolution)
        resolution.isDuplicate = true
      else
        throw new Error(`duplicate collection item: ${key}`)
    }
    else if (resolution)
      resolution.isDuplicate = false
    return item
  }

  add(instance: T): Item<T> {
    const key = this.getKey(instance)
    if (this.lookup(key) !== undefined)
      throw new Error(`key is already in use: ${key}`)
    let tag = this.tag
    if (tag < 0) { // merge is not in progress
      tag = ~this.tag + 1
      this.tag = ~tag // one item merge cycle
    }
    const item = new ItemImpl<T>(instance, tag)
    this.map.set(key, item)
    this.lastNotFoundKey = undefined
    this.strictNextItem = undefined
    this.current.include(item)
    this.added.aux(item)
    return item
  }

  remove(item: Item<T>): void {
    const t = item as ItemImpl<T>
    if (!this.isRemoved(t)) {
      this.current.exclude(t)
      this.removed.include(t)
      t.tag--
    }
  }

  move(item: Item<T>, after: Item<T>): void {
    throw new Error('not implemented')
  }

  beginMerge(): void {
    if (this.isMergeInProgress)
      throw new Error('merge is in progress already')
    this.tag = ~this.tag + 1
    this.strictNextItem = this.current.first
    this.removed.grab(this.current, false)
    this.added.reset()
  }

  endMerge(error?: unknown): void {
    if (!this.isMergeInProgress)
      throw new Error('merge is ended already')
    this.tag = ~this.tag
    if (error === undefined) {
      const currentCount = this.current.count
      if (currentCount > 0) {
        const getKey = this.getKey
        if (currentCount > this.removed.count) { // it should be faster to delete vanished items
          const map = this.map
          for (const x of this.removed.items())
            map.delete(getKey(x.instance))
        }
        else { // it should be faster to recreate map using current items
          const map = this.map = new Map<string | undefined, ItemImpl<T>>()
          for (const x of this.current.items())
            map.set(getKey(x.instance), x)
        }
      }
      else // just create new empty map
        this.map = new Map<string | undefined, ItemImpl<T>>()
    }
    else {
      this.current.grab(this.removed, true)
      const getKey = this.getKey
      for (const x of this.added.itemsViaAux()) {
        this.map.delete(getKey(x.instance))
        this.current.exclude(x)
      }
      this.added.reset()
    }
  }

  resetAddedAndRemovedLists(): void {
    this.removed.reset()
    this.added.reset()
  }

  lastClaimedItem(): Item<T> | undefined {
    return this.current.last
  }

  *items(): Generator<Item<T>> {
    let x = this.current.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
  }

  *addedItems(reset?: boolean): Generator<Item<T>> {
    let x = this.added.first
    while (x !== undefined) {
      const next = x.aux
      if (!this.isRemoved(x))
        yield x
      x = next
    }
    if (reset)
      this.added.reset()
  }

  *removedItems(reset?: boolean): Generator<Item<T>> {
    let x = this.removed.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
    if (reset)
      this.removed.reset()
  }

  isAdded(item: Item<T>): boolean {
    const t = item as ItemImpl<T>
    let tag = this.tag
    if (tag < 0)
      tag = ~tag
    return t.status === ~tag && t.tag > 0
  }

  isMoved(item: Item<T>): boolean {
    const t = item as ItemImpl<T>
    let tag = this.tag
    if (tag < 0)
      tag = ~tag
    return t.status === tag && t.tag > 0
  }

  isRemoved(item: Item<T>): boolean {
    const t = item as ItemImpl<T>
    const tag = this.tag
    return tag > 0 ? t.tag < tag : t.tag < tag - 1
  }

  isCurrent(item: Item<T>): boolean {
    const t = item as ItemImpl<T>
    return t.tag === this.tag
  }

  markAsMoved(item: Item<T>): void {
    const t = item as ItemImpl<T>
    if (t.tag > 0) // if not removed, > is intentional
      t.status = t.tag
  }

  static createItem<T>(instance: T): Item<T> {
    return new ItemImpl(instance, 0)
  }
}

class ItemImpl<T> implements Item<T> {
  readonly instance: T
  tag: number
  status: number
  next?: ItemImpl<T>
  prev?: ItemImpl<T>
  aux?: ItemImpl<T>

  constructor(instance: T, tag: number) {
    this.instance = instance
    this.tag = tag
    this.status = ~tag // isAdded=true
    this.next = undefined
    this.prev = undefined
    this.aux = undefined
  }
}

class ItemChain<T> {
  count: number = 0
  first?: ItemImpl<T> = undefined
  last?: ItemImpl<T> = undefined

  public *items(): Generator<ItemImpl<T>> {
    let x = this.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
  }

  public *itemsViaAux(): Generator<ItemImpl<T>> {
    let x = this.first
    while (x !== undefined) {
      const next = x.aux
      yield x
      x = next
    }
  }

  reset(): void {
    this.count = 0
    this.first = undefined
    this.last = undefined
  }

  grab(from: ItemChain<T>, join: boolean): void {
    const head = from.first
    if (join && head) {
      const last = this.last
      head.prev = last
      if (last)
        this.last = last.next = head
      else
        this.first = this.last = head
      this.count += from.count
    }
    else {
      this.count = from.count
      this.first = head
      this.last = from.last
    }
    from.reset()
  }

  include(item: ItemImpl<T>): void {
    const last = this.last
    item.prev = last
    item.next = undefined
    if (last)
      this.last = last.next = item
    else
      this.first = this.last = item
    this.count++
  }

  exclude(item: ItemImpl<T>): void {
    if (item.prev !== undefined)
      item.prev.next = item.next
    if (item.next !== undefined)
      item.next.prev = item.prev
    if (item === this.first)
      this.first = item.next
    this.count--
  }

  aux(item: ItemImpl<T>): void {
    item.aux = undefined
    const last = this.last
    if (last)
      this.last = last.aux = item
    else
      this.first = this.last = item
    this.count++
  }
}
