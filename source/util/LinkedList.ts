// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"

// Mark / Отметка

export enum Mark {

  existing = 0, // существующий

  added = 1,    // добавленный

  moved = 2,    // перемещённый

  removed = 3,  // удалённый

}

const MARK_MOD = 4

// Linked / Связанное

export type ExtractItemKey<T = unknown> = (node: T) => string | undefined

export interface Linked<T> {

  readonly value: T

  readonly list: LinkedList<T>

  readonly next?: Linked<T>

  readonly prev?: Linked<T>

  readonly index: number

  readonly mark: Mark

}

// LinkedListReader / СписокСвязанныйЧитаемый

export interface LinkedListReader<T> {

  readonly isStrictChildrenOrder: boolean

  readonly items: LinkedSubListReader<T>

  lookup(key: string): Linked<T> | undefined
}

export interface LinkedSubListReader<T> {

  readonly count: number

  readonly first?: Linked<T>

  readonly last?: Linked<T>

}

// LinkedListRenovation / РеновацияСпискаСвязанного

export interface LinkedListRenovation<T> {

  mark: number

  list: LinkedList<T>

  lookup(key: string | undefined): Linked<T> | undefined

  tryReuse(key: string,
    resolution?: { isDuplicate: boolean },
    error?: string): Linked<T> | undefined

  add(instance: T, before?: Linked<T>): Linked<T>

  remove(item: Linked<T>): void

  move(item: Linked<T>, before: Linked<T> | undefined): void

  markAsMoved(item: Linked<T>): void

  added(): Generator<Linked<T>>

  removed(): Generator<Linked<T>>

}

export class LinkedListRenovation$<T> implements LinkedListRenovation<T> {

  private static markGen: number = 0

  mark: number

  list: LinkedList<T>

  private actual$: LinkedSubList$<T>

  private added$: Array<Linked$<T>> | undefined

  private pending$: LinkedSubList$<T>

  private expectedNext: Linked$<T> | undefined

  private lastUnknownKey: string | undefined

  constructor(list: LinkedList<T>, actual: LinkedSubList$<T>, pending: LinkedSubList$<T>) {
    this.mark = (LinkedListRenovation$.markGen += MARK_MOD)
    this.list = list
    this.actual$ = actual
    this.added$ = undefined
    this.pending$ = pending
    this.expectedNext = pending.first
    this.lastUnknownKey = undefined
  }

  lookup(key: string | undefined): Linked<T> | undefined {
    let result: Linked<T> | undefined = undefined
    if (key !== undefined && key !== this.lastUnknownKey) {
      result = this.list.lookup(key)
      if (result !== undefined) {
        if (this.list.extractKey(result.value) !== key) {
          this.lastUnknownKey = key
          result = undefined
        }
      }
      else
        this.lastUnknownKey = key
    }
    return result
  }

  tryReuse(key: string, resolution?: { isDuplicate: boolean }, error?: string): Linked<T> | undefined {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse(error ?? "renovation is not in progress")
    let item = this.expectedNext
    if (key !== (item ? list.extractKey(item.value) : undefined))
      item = this.lookup(key) as Linked$<T> | undefined
    if (item !== undefined) {
      const m = this.mark
      const distance = item.mark$ - m
      if (distance < 0 || distance >= MARK_MOD) {
        if (list.isStrictChildrenOrder && item !== this.expectedNext)
          item.mark$ = m + Mark.moved
        else
          item.mark$ = m + Mark.existing
        this.expectedNext = this.pending$.nextOf(item)
        this.pending$.exclude(item)
        item.index = this.actual$.count
        this.actual$.include(item)
        if (resolution)
          resolution.isDuplicate = false
      }
      else if (resolution)
        resolution.isDuplicate = true
      else
        throw misuse(`duplicate key: ${key}`)
    }
    else if (resolution)
      resolution.isDuplicate = false
    return item
  }

  add(value: T, before?: Linked<T>): Linked<T> {
    const item = this.list.add(value) as Linked$<T>
    const m = this.mark
    item.mark$ = m > 0 ? m + Mark.added : m
    this.lastUnknownKey = undefined
    this.expectedNext = undefined
    item.index = this.actual$.count
    let added = this.added$
    if (added == undefined)
      added = this.added$ = []
    added.push(item)
    return item
  }

  remove(item: Linked<T>): void {
    const x = item as Linked$<T>
    const m = this.mark
    x.mark$ = m + Mark.removed
  }

  move(item: Linked<T>, before: Linked<T> | undefined): void {
    throw misuse("not implemented")
  }

  markAsMoved(item: Linked<T>): void {
    if (!this.list.isRenovationInProgress)
      throw misuse("item cannot be marked as moved outside of renovation cycle")
    const x = item as Linked$<T>
    x.mark$ = this.mark + Mark.moved
  }

  *actual(): Generator<Linked<T>> {
    throw misuse("not implemented")
  }

  *added(): Generator<Linked<T>> {
    throw misuse("not implemented")
  }

  *removed(): Generator<Linked<T>> {
    throw misuse("not implemented")
  }

  done(error: unknown): void {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse("renovation is ended already")
    if (error === undefined) {
      for (const x of this.pending$.items()) {
        x.mark$ = this.mark + Mark.removed
        list.remove(x)
      }
    }
    else {
      this.actual$.grab(this.pending$, true)
      if (this.added$ !== undefined) {
        for (const x of this.added$) {
          list.remove(x)
        }
        this.added$ = undefined
      }
    }
  }

}

// LinkedList / СписокСвязанный

export class LinkedList<T> implements LinkedListReader<T> {

  readonly extractKey: ExtractItemKey<T>

  private isStrictOrder$: boolean

  private map: Map<string | undefined, Linked$<T>>

  private actual$: LinkedSubList$<T>

  private pending$: LinkedSubList$<T> | undefined

  constructor(extractKey: ExtractItemKey<T>, isStrictOrder: boolean = false) {
    this.extractKey = extractKey
    this.isStrictOrder$ = isStrictOrder
    this.map = new Map<string | undefined, Linked$<T>>()
    this.actual$ = new LinkedSubList$<T>()
    this.pending$ = undefined
  }

  get isStrictChildrenOrder(): boolean { return this.isStrictOrder$ }
  set isStrictChildrenOrder(value: boolean) {
    if (this.pending$ !== undefined)
      throw misuse("cannot change strict mode in the middle of renovation")
    this.isStrictOrder$ = value
  }

  get isRenovationInProgress(): boolean {
    return this.pending$ !== undefined
  }

  get count(): number {
    return this.actual$.count + (this.pending$?.count ?? 0)
  }

  get items(): LinkedSubListReader<T> {
    return this.actual$
  }

  lookup(key: string | undefined): Linked<T> | undefined {
    return this.map.get(key)
  }

  add(value: T): Linked<T> {
    const key = this.extractKey(value)
    if (this.map.get(key) !== undefined)
      throw misuse(`key is already in use: ${key}`)
    const item = new Linked$<T>(value, this, 0)
    this.map.set(key, item)
    this.actual$.include(item)
    return item
  }

  remove(item: Linked<T>): void {
    throw misuse("not implemented")
  }

  beginRenovation(): LinkedListRenovation<T> {
    if (this.pending$ !== undefined)
      throw misuse("renovation is in progress already")
    const existing = this.actual$
    this.actual$ = new LinkedSubList$<T>()
    return new LinkedListRenovation$<T>(this, this.actual$, existing)
  }

  endRenovation(r: LinkedListRenovation<T>, error?: unknown): void {
    const renovation = r as LinkedListRenovation$<T>
    renovation.done(error)
    this.pending$ = undefined
  }

}

// Linked$

class Linked$<T> implements Linked<T> {

  readonly value: T

  list: LinkedList<T>

  next?: Linked$<T>

  prev?: Linked$<T>

  index: number

  mark$: number

  constructor(value: T, list: LinkedList<T>, mark$: number) {
    this.value = value
    this.list = list
    this.next = undefined
    this.prev = undefined
    this.index = -1
    this.mark$ = mark$
  }

  get mark(): Mark {
    return this.mark$ % MARK_MOD
  }

}

// AbstractLinkedSubList

abstract class AbstractLinkedSubList<T> implements LinkedSubListReader<T> {

  count: number = 0

  first?: Linked$<T> = undefined

  last?: Linked$<T> = undefined

  abstract nextOf(item: Linked$<T>): Linked$<T> | undefined

  abstract setNextOf(item: Linked$<T>, next: Linked$<T> | undefined): Linked$<T> | undefined

  abstract prevOf(item: Linked$<T>): Linked$<T> | undefined

  abstract setPrevOf(item: Linked$<T>, prev: Linked$<T> | undefined): Linked$<T> | undefined

  *items(): Generator<Linked$<T>> {
    let x = this.first
    while (x !== undefined) {
      const next = this.nextOf(x)
      yield x
      x = next
    }
  }

  include(item: Linked$<T>, before?: Linked$<T>): void {
    const last = this.last
    this.setPrevOf(item, last)
    this.setNextOf(item, undefined)
    if (last !== undefined)
      this.last = this.setNextOf(last, item)
    else
      this.first = this.last = item
    this.count++
  }

  exclude(item: Linked$<T>): void {
    const prev = this.prevOf(item)
    if (prev !== undefined)
      this.setNextOf(prev, this.nextOf(item))
    const next = this.nextOf(item)
    if (next !== undefined)
      this.setPrevOf(next, this.prevOf(item))
    if (item === this.first)
      this.first = this.nextOf(item)
    this.count--
  }

  clear(): void {
    this.count = 0
    this.first = undefined
    this.last = undefined
  }

}

// LinkedSubList$

class LinkedSubList$<T> extends AbstractLinkedSubList<T> {

  override nextOf(item: Linked$<T>): Linked$<T> | undefined {
    return item.next
  }

  override setNextOf(item: Linked$<T>, next: Linked$<T> | undefined): Linked$<T> | undefined {
    item.next = next
    return next
  }

  override prevOf(item: Linked$<T>): Linked$<T> | undefined {
    return item.prev
  }

  override setPrevOf(item: Linked$<T>, prev: Linked$<T> | undefined): Linked$<T> | undefined {
    item.prev = prev
    return prev
  }

  grab(from: LinkedSubList$<T>, join: boolean): void {
    const head = from.first
    if (join !== undefined && head !== undefined) {
      const last = this.last
      this.setPrevOf(head, last)
      if (last !== undefined)
        this.last = this.setNextOf(last, head)
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
