// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

export type GetMergeItemKey<T = unknown> = (item: T) => string | undefined

export interface MergeListReader<T> {
  // readonly getKey: GetKey<T>
  readonly isStrict: boolean
  readonly count: number
  readonly addedCount: number
  readonly removedCount: number
  readonly isMergeInProgress: boolean

  lookup(key: string): MergeItem<T> | undefined
  claim(key: string): MergeItem<T> | undefined
  add(instance: T): MergeItem<T>
  remove(item: MergeItem<T>): void
  move(item: MergeItem<T>, after: MergeItem<T>): void
  beginMerge(): void
  endMerge(error?: unknown): void
  resetAddedAndRemovedLists(): void
  lastClaimedItem(): MergeItem<T> | undefined

  items(): Generator<MergeItem<T>>
  addedItems(reset?: boolean): Generator<MergeItem<T>>
  removedItems(reset?: boolean): Generator<MergeItem<T>>
  isAdded(item: MergeItem<T>): boolean
  isMoved(item: MergeItem<T>): boolean
  isRemoved(item: MergeItem<T>): boolean
  isCurrent(item: MergeItem<T>): boolean
}

export interface MergeItem<T> {
  readonly instance: T
  // readonly next?: MergeItem<T>
  readonly prev?: MergeItem<T> // TODO: hide
  aux?: MergeItem<T> // TODO: hide
}

export class MergeList<T> implements MergeListReader<T> {
  readonly getKey: GetMergeItemKey<T>
  private strict: boolean
  private map: Map<string | undefined, MergeItemImpl<T>>
  private tag: number
  private current: MergeItemChain<T>
  private added: MergeItemChain<T>
  private removed: MergeItemChain<T>
  private lastNotFoundKey: string | undefined
  private strictNextItem?: MergeItemImpl<T>

  constructor(getKey: GetMergeItemKey<T>, strict: boolean = false) {
    this.getKey = getKey
    this.strict = strict
    this.map = new Map<string | undefined, MergeItemImpl<T>>()
    this.tag = ~0
    this.current = new MergeItemChain<T>()
    this.added = new MergeItemChain<T>()
    this.removed = new MergeItemChain<T>()
    this.lastNotFoundKey = undefined
    this.strictNextItem = undefined
  }

  get isStrict(): boolean { return this.strict }
  set isStrict(value: boolean) {
    if (this.isMergeInProgress && this.current.count > 0)
      throw new Error('cannot change strict mode in the middle of merge')
    this.strict = value
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

  lookup(key: string | undefined): MergeItem<T> | undefined {
    let result: MergeItem<T> | undefined = undefined
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

  claim(key: string, resolution?: { isDuplicate: boolean }, error?: string): MergeItem<T> | undefined {
    const tag = this.tag
    if (tag < 0)
      throw new Error(error ?? 'merge is not in progress')
    let item = this.strictNextItem
    if (key !== (item ? this.getKey(item.instance) : undefined))
      item = this.lookup(key) as MergeItemImpl<T> | undefined
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

  add(instance: T): MergeItem<T> {
    const key = this.getKey(instance)
    if (this.lookup(key) !== undefined)
      throw new Error(`key is already in use: ${key}`)
    let tag = this.tag
    if (tag < 0) { // merge is not in progress
      tag = ~this.tag + 1
      this.tag = ~tag // one item merge cycle
    }
    const item = new MergeItemImpl<T>(instance, tag)
    this.map.set(key, item)
    this.lastNotFoundKey = undefined
    this.strictNextItem = undefined
    this.current.include(item)
    this.added.aux(item)
    return item
  }

  remove(item: MergeItem<T>): void {
    const t = item as MergeItemImpl<T>
    if (!this.isRemoved(t)) {
      this.current.exclude(t)
      this.removed.include(t)
      t.tag--
    }
  }

  move(item: MergeItem<T>, after: MergeItem<T>): void {
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
          const map = this.map = new Map<string | undefined, MergeItemImpl<T>>()
          for (const x of this.current.items())
            map.set(getKey(x.instance), x)
        }
      }
      else // just create new empty map
        this.map = new Map<string | undefined, MergeItemImpl<T>>()
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

  lastClaimedItem(): MergeItem<T> | undefined {
    return this.current.last
  }

  *items(): Generator<MergeItem<T>> {
    let x = this.current.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
  }

  *addedItems(reset?: boolean): Generator<MergeItem<T>> {
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

  *removedItems(reset?: boolean): Generator<MergeItem<T>> {
    let x = this.removed.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
    if (reset)
      this.removed.reset()
  }

  isAdded(item: MergeItem<T>): boolean {
    const t = item as MergeItemImpl<T>
    let tag = this.tag
    if (tag < 0)
      tag = ~tag
    return t.status === ~tag && t.tag > 0
  }

  isMoved(item: MergeItem<T>): boolean {
    const t = item as MergeItemImpl<T>
    let tag = this.tag
    if (tag < 0)
      tag = ~tag
    return t.status === tag && t.tag > 0
  }

  isRemoved(item: MergeItem<T>): boolean {
    const t = item as MergeItemImpl<T>
    const tag = this.tag
    return tag > 0 ? t.tag < tag : t.tag < tag - 1
  }

  isCurrent(item: MergeItem<T>): boolean {
    const t = item as MergeItemImpl<T>
    return t.tag === this.tag
  }

  markAsMoved(item: MergeItem<T>): void {
    const t = item as MergeItemImpl<T>
    if (t.tag > 0) // if not removed, > is intentional
      t.status = t.tag
  }

  static createItem<T>(instance: T): MergeItem<T> {
    return new MergeItemImpl(instance, 0)
  }
}

class MergeItemImpl<T> implements MergeItem<T> {
  readonly instance: T
  tag: number
  status: number
  next?: MergeItemImpl<T>
  prev?: MergeItemImpl<T>
  aux?: MergeItemImpl<T>

  constructor(instance: T, tag: number) {
    this.instance = instance
    this.tag = tag
    this.status = ~tag // isAdded=true
    this.next = undefined
    this.prev = undefined
    this.aux = undefined
  }
}

class MergeItemChain<T> {
  count: number = 0
  first?: MergeItemImpl<T> = undefined
  last?: MergeItemImpl<T> = undefined

  public *items(): Generator<MergeItemImpl<T>> {
    let x = this.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
  }

  public *itemsViaAux(): Generator<MergeItemImpl<T>> {
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

  grab(from: MergeItemChain<T>, join: boolean): void {
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

  include(item: MergeItemImpl<T>): void {
    const last = this.last
    item.prev = last
    item.next = undefined
    if (last)
      this.last = last.next = item
    else
      this.first = this.last = item
    this.count++
  }

  exclude(item: MergeItemImpl<T>): void {
    if (item.prev !== undefined)
      item.prev.next = item.next
    if (item.next !== undefined)
      item.next.prev = item.prev
    if (item === this.first)
      this.first = item.next
    this.count--
  }

  aux(item: MergeItemImpl<T>): void {
    item.aux = undefined
    const last = this.last
    if (last)
      this.last = last.aux = item
    else
      this.first = this.last = item
    this.count++
  }
}
