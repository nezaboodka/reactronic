// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"

export type GetListItemKey<T = unknown> = (item: T) => string | undefined

export type ReconciliationListReader<T> = {
  // readonly getKey: GetListItemKey<T>
  readonly isStrict: boolean
  readonly count: number
  readonly countOfAdded: number
  readonly countOfRemoved: number
  readonly isReconciliationInProgress: boolean

  lookup(key: string): LinkedItem<T> | undefined
  firstItem(): LinkedItem<T> | undefined
  lastItem(): LinkedItem<T> | undefined

  items(onlyAfter?: LinkedItem<T>): Generator<LinkedItem<T>>
  itemsAdded(reset?: boolean): Generator<LinkedItem<T>>
  itemsRemoved(reset?: boolean): Generator<LinkedItem<T>>
  isAdded(item: LinkedItem<T>): boolean
  isMoved(item: LinkedItem<T>): boolean
  isRemoved(item: LinkedItem<T>): boolean
  isFresh(item: LinkedItem<T>): boolean
}

export type LinkedItem<T> = {
  readonly instance: T
  readonly index: number
  readonly next?: LinkedItem<T> // TODO: hide
  readonly prev?: LinkedItem<T> // TODO: hide
  aux?: LinkedItem<T> // TODO: hide
}

// ReconciliationList / СписокСверки

export class ReconciliationList<T> implements ReconciliationListReader<T> {
  readonly getKey: GetListItemKey<T>
  private strict: boolean
  private map: Map<string | undefined, LinkedItemImpl<T>>
  private tag: number
  private fresh: LinkedItemChain<T>
  private added: LinkedItemChain<T>
  private removed: LinkedItemChain<T>
  private lastNotFoundKey: string | undefined
  private strictNextItem?: LinkedItemImpl<T>

  constructor(getKey: GetListItemKey<T>, strict: boolean = false) {
    this.getKey = getKey
    this.strict = strict
    this.map = new Map<string | undefined, LinkedItemImpl<T>>()
    this.tag = ~0
    this.fresh = new LinkedItemChain<T>()
    this.added = new LinkedItemChain<T>()
    this.removed = new LinkedItemChain<T>()
    this.lastNotFoundKey = undefined
    this.strictNextItem = undefined
  }

  get isStrict(): boolean { return this.strict }
  set isStrict(value: boolean) {
    if (this.isReconciliationInProgress && this.fresh.count > 0)
      throw misuse("cannot change strict mode in the middle of reconciliation")
    this.strict = value
  }

  get count(): number {
    return this.fresh.count
  }

  get countOfAdded(): number {
    return this.added.count
  }

  get countOfRemoved(): number {
    return this.removed.count
  }

  get isReconciliationInProgress(): boolean {
    return this.tag > 0
  }

  lookup(key: string | undefined): LinkedItem<T> | undefined {
    let result: LinkedItem<T> | undefined = undefined
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

  tryReuse(key: string, resolution?: { isDuplicate: boolean }, error?: string): LinkedItem<T> | undefined {
    const tag = this.tag
    if (tag < 0)
      throw misuse(error ?? "reconciliation is not in progress")
    let item = this.strictNextItem
    if (key !== (item ? this.getKey(item.instance) : undefined))
      item = this.lookup(key) as LinkedItemImpl<T> | undefined
    if (item) {
      if (item.tag !== tag) {
        item.tag = tag
        if (this.strict && item !== this.strictNextItem)
          item.status = tag // isAdded=false, isMoved=true
        this.strictNextItem = item.next
        this.removed.exclude(item)
        item.index = this.fresh.count
        this.fresh.include(item)
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

  add(instance: T): LinkedItem<T> {
    const key = this.getKey(instance)
    if (this.lookup(key) !== undefined)
      throw misuse(`key is already in use: ${key}`)
    let tag = this.tag
    if (tag < 0) { // reconciliation is not in progress
      tag = ~this.tag + 1
      this.tag = ~tag // (!) EXTERNAL?
      // throw misuse("TBD")
    }
    const item = new LinkedItemImpl<T>(instance, tag)
    this.map.set(key, item)
    this.lastNotFoundKey = undefined
    this.strictNextItem = undefined
    item.index = this.fresh.count
    this.fresh.include(item)
    this.added.aux(item)
    return item
  }

  remove(item: LinkedItem<T>): void {
    const t = item as LinkedItemImpl<T>
    if (!this.isRemoved(t)) {
      this.fresh.exclude(t)
      this.removed.include(t)
      t.tag--
    }
  }

  move(item: LinkedItem<T>, after: LinkedItem<T>): void {
    throw misuse("not implemented")
  }

  beginReconciliation(): void {
    if (this.isReconciliationInProgress)
      throw misuse("reconciliation is in progress already")
    this.tag = ~this.tag + 1
    this.strictNextItem = this.fresh.first
    this.removed.grab(this.fresh, false)
    this.added.reset()
  }

  endReconciliation(error?: unknown): void {
    if (!this.isReconciliationInProgress)
      throw misuse("reconciliation is ended already")
    this.tag = ~this.tag
    if (error === undefined) {
      const freshCount = this.fresh.count
      if (freshCount > 0) {
        const getKey = this.getKey
        if (freshCount > this.removed.count) { // it should be faster to delete vanished items
          const map = this.map
          for (const x of this.removed.items())
            map.delete(getKey(x.instance))
        }
        else { // it should be faster to recreate map using fresh items
          const map = this.map = new Map<string | undefined, LinkedItemImpl<T>>()
          for (const x of this.fresh.items())
            map.set(getKey(x.instance), x)
        }
      }
      else // just create new empty map
        this.map = new Map<string | undefined, LinkedItemImpl<T>>()
    }
    else {
      this.fresh.grab(this.removed, true)
      const getKey = this.getKey
      for (const x of this.added.itemsViaAux()) {
        this.map.delete(getKey(x.instance))
        this.fresh.exclude(x)
      }
      this.added.reset()
    }
  }

  resetAddedAndRemovedLists(): void {
    this.removed.reset()
    this.added.reset()
  }

  firstItem(): LinkedItem<T> | undefined {
    return this.fresh.first
  }

  lastItem(): LinkedItem<T> | undefined {
    return this.fresh.last
  }

  *items(onlyAfter?: LinkedItem<T>): Generator<LinkedItem<T>> {
    let x = onlyAfter?.next ?? this.fresh.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
  }

  *itemsAdded(reset?: boolean): Generator<LinkedItem<T>> {
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

  *itemsRemoved(reset?: boolean): Generator<LinkedItem<T>> {
    let x = this.removed.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
    if (reset)
      this.removed.reset()
  }

  isAdded(item: LinkedItem<T>): boolean {
    const t = item as LinkedItemImpl<T>
    let tag = this.tag
    if (tag < 0)
      tag = ~tag
    return t.status === ~tag && t.tag > 0
  }

  isMoved(item: LinkedItem<T>): boolean {
    const t = item as LinkedItemImpl<T>
    let tag = this.tag
    if (tag < 0)
      tag = ~tag
    return t.status === tag && t.tag > 0
  }

  isRemoved(item: LinkedItem<T>): boolean {
    const t = item as LinkedItemImpl<T>
    const tag = this.tag
    return tag > 0 ? t.tag < tag : t.tag < tag - 1
  }

  isFresh(item: LinkedItem<T>): boolean {
    const t = item as LinkedItemImpl<T>
    return t.tag === this.tag
  }

  markAsMoved(item: LinkedItem<T>): void {
    const t = item as LinkedItemImpl<T>
    if (t.tag > 0) // if not removed, > is intentional
      t.status = t.tag
  }

  static createItem<T>(instance: T): LinkedItem<T> {
    return new LinkedItemImpl(instance, 0)
  }
}

class LinkedItemImpl<T> implements LinkedItem<T> {
  readonly instance: T
  index: number
  tag: number
  status: number
  next?: LinkedItemImpl<T>
  prev?: LinkedItemImpl<T>
  aux?: LinkedItemImpl<T>

  constructor(instance: T, tag: number) {
    this.instance = instance
    this.index = -1
    this.tag = tag
    this.status = ~tag // isAdded=true
    this.next = undefined
    this.prev = undefined
    this.aux = undefined
  }
}

class LinkedItemChain<T> {
  count: number = 0
  first?: LinkedItemImpl<T> = undefined
  last?: LinkedItemImpl<T> = undefined

  public *items(): Generator<LinkedItemImpl<T>> {
    let x = this.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
  }

  public *itemsViaAux(): Generator<LinkedItemImpl<T>> {
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

  grab(from: LinkedItemChain<T>, join: boolean): void {
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

  include(item: LinkedItemImpl<T>): void {
    const last = this.last
    item.prev = last
    item.next = undefined
    if (last)
      this.last = last.next = item
    else
      this.first = this.last = item
    this.count++
  }

  exclude(item: LinkedItemImpl<T>): void {
    if (item.prev !== undefined)
      item.prev.next = item.next
    if (item.next !== undefined)
      item.next.prev = item.prev
    if (item === this.first)
      this.first = item.next
    this.count--
  }

  aux(item: LinkedItemImpl<T>): void {
    item.aux = undefined
    const last = this.last
    if (last)
      this.last = last.aux = item
    else
      this.first = this.last = item
    this.count++
  }
}
