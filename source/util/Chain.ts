// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"

export type GetChainItemKey<T = unknown> = (payload: T) => string | undefined

export enum UpdateStatus {
  reused = 0,
  added = 1,
  moved = 2,
  removed = 3,
}

export type Chained<T> = {
  readonly payload: T
  readonly index: number
  readonly status: UpdateStatus
  readonly next?: Chained<T>
  readonly prev?: Chained<T>
}

export type ChainReader<T> = {
  readonly isStrict: boolean
  readonly isUpdateInProgress: boolean
  readonly actual: SubChain<T>
  readonly addedDuringUpdate: SubChain<T>
  readonly removedDuringUpdate: SubChain<T>
  lookup(key: string): Chained<T> | undefined
}

export type SubChain<T> = {
  readonly count: number
  readonly first?: Chained<T>
  readonly last?: Chained<T>
}

// Chain / Цепочка

export class Chain<T> implements ChainReader<T> {
  readonly getKey: GetChainItemKey<T>
  private isStrict$: boolean
  private map: Map<string | undefined, Chained$<T>>
  private marker: number
  private actual$: SubChain$<T>
  private addedDuringUpdate$: AuxSubChain$<T>
  private removedDuringUpdate$: SubChain$<T>
  private lastNotFoundKey: string | undefined
  private expectedNextItem?: Chained$<T>

  constructor(getKey: GetChainItemKey<T>, isStrict: boolean = false) {
    this.getKey = getKey
    this.isStrict$ = isStrict
    this.map = new Map<string | undefined, Chained$<T>>()
    this.marker = ~1
    this.actual$ = new SubChain$<T>()
    this.addedDuringUpdate$ = new AuxSubChain$<T>()
    this.removedDuringUpdate$ = new SubChain$<T>()
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
    return this.marker > 0
  }

  get actual(): SubChain<T> {
    return this.actual$
  }

  get addedDuringUpdate(): SubChain<T> {
    return this.addedDuringUpdate$
  }

  get removedDuringUpdate(): SubChain<T> {
    return this.removedDuringUpdate$
  }

  lookup(key: string | undefined): Chained<T> | undefined {
    let result: Chained<T> | undefined = undefined
    if (key !== undefined && key !== this.lastNotFoundKey) {
      result = this.map.get(key)
      if (result !== undefined) {
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
    if (!this.isUpdateInProgress)
      throw misuse(error ?? "update is not in progress")
    let item = this.expectedNextItem
    if (key !== (item ? this.getKey(item.payload) : undefined))
      item = this.lookup(key) as Chained$<T> | undefined
    if (item !== undefined) {
      if (!this.markerMatchesTo(item)) {
        if (this.isStrict$ && item !== this.expectedNextItem)
          this.mark(item, UpdateStatus.moved)
        else
          this.mark(item, UpdateStatus.reused)
        this.expectedNextItem = this.removedDuringUpdate$.getActualNextOf(item)
        this.removedDuringUpdate$.exclude(item)
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

  add(instance: T, before?: Chained<T>): Chained<T> {
    const key = this.getKey(instance)
    if (this.lookup(key) !== undefined)
      throw misuse(`key is already in use: ${key}`)
    const marker = this.marker > 0 ? this.marker : 0
    const item = new Chained$<T>(instance, marker)
    this.map.set(key, item)
    this.lastNotFoundKey = undefined
    this.expectedNextItem = undefined
    item.index = this.actual$.count
    this.actual$.include(item, before as Chained$<T>)
    if (marker !== 0) // if not external
      this.addedDuringUpdate$.include(item)
    return item
  }

  remove(item: Chained<T>): void {
    if (item.status !== UpdateStatus.removed) {
      const x = item as Chained$<T>
      this.actual$.exclude(x)
      this.removedDuringUpdate$.include(x)
      this.mark(x, UpdateStatus.removed)
    }
  }

  move(item: Chained<T>, before: Chained<T> | undefined): void {
    throw misuse("not implemented")
  }

  markAsMoved(item: Chained<T>): void {
    const x = item as Chained$<T>
    this.mark(x, UpdateStatus.moved)
  }

  beginUpdate(): void {
    const marker = this.marker
    if (marker > 0)
      throw misuse("update is in progress already")
    this.marker = ~marker + 1
    this.expectedNextItem = this.actual$.first
    this.removedDuringUpdate$.grab(this.actual$, false)
    this.addedDuringUpdate$.clear()
  }

  endUpdate(error?: unknown): void {
    const marker = this.marker
    if (marker < 0)
      throw misuse("update is ended already")
    if (error === undefined) {
      const getKey = this.getKey
      const map = this.map
      for (const x of this.removedDuringUpdate$.items()) {
        this.mark(x, UpdateStatus.removed)
        map.delete(getKey(x.payload))
      }
    }
    else {
      this.actual$.grab(this.removedDuringUpdate$, true)
      const getKey = this.getKey
      for (const x of this.addedDuringUpdate$.items()) {
        this.map.delete(getKey(x.payload))
        this.actual$.exclude(x)
      }
      this.addedDuringUpdate$.clear()
    }
    this.marker = ~marker
  }

  clearAddedAndRemoved(): void {
    this.addedDuringUpdate$.clear()
    this.removedDuringUpdate$.clear()
  }

  static createItem<T>(instance: T): Chained<T> {
    return new Chained$<T>(instance, 0)
  }

  // Internal

  private markerMatchesTo(item: Chained$<T>): boolean {
    return Math.trunc(item.marker / MARKER_SIZE) === this.marker
  }

  private mark(item: Chained$<T>, status: UpdateStatus): void {
    const marker = this.marker > 0 ? this.marker : ~this.marker
    item.marker = marker * MARKER_SIZE + status
  }
}

// Chained$

class Chained$<T> implements Chained<T> {
  readonly payload: T
  index: number
  marker: number
  next?: Chained$<T>
  prev?: Chained$<T>
  aux?: Chained$<T>

  constructor(instance: T, marker: number) {
    this.payload = instance
    this.index = -1
    this.marker = marker
    this.next = undefined
    this.prev = undefined
    this.aux = undefined
  }

  get status(): UpdateStatus {
    return this.marker % MARKER_SIZE
  }
}

// AbstractSubChain

abstract class AbstractSubChain<T> implements SubChain<T> {
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

  include(item: Chained$<T>, before?: Chained$<T>): void {
    const last = this.last
    this.setActualPrevOf(item, last)
    this.setActualNextOf(item, undefined)
    if (last !== undefined)
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

class SubChain$<T> extends AbstractSubChain<T> {
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

  grab(from: SubChain$<T>, join: boolean): void {
    const head = from.first
    if (join !== undefined && head !== undefined) {
      const last = this.last
      this.setActualPrevOf(head, last)
      if (last !== undefined)
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

class AuxSubChain$<T> extends AbstractSubChain<T> {
  override getActualNextOf(item: Chained$<T>): Chained$<T> | undefined {
    return item.aux
  }

  override setActualNextOf(item: Chained$<T>, next: Chained$<T> | undefined): Chained$<T> | undefined {
    item.aux = next
    return next
  }

  override getActualPrevOf(item: Chained$<T>): Chained$<T> | undefined {
    return undefined
  }

  override setActualPrevOf(item: Chained$<T>, prev: Chained$<T> | undefined): Chained$<T> | undefined {
    return undefined
  }
}

const MARKER_SIZE = 4
