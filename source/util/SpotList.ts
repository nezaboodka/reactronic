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

// Spot / Спот

export type ExtractSpotKey<T = unknown> = (node: T) => string | undefined

export interface Spot<T> {

  readonly value: T

  readonly list: SpotList<T>

  readonly next?: Spot<T>

  readonly prev?: Spot<T>

  readonly index: number

  readonly mark: Mark

}

// SpotListReader / СпотДеревоЧитаемое

export interface SpotListReader<T> {

  readonly isStrictChildrenOrder: boolean

  readonly items: SpotSubListReader<T>

  lookup(key: string): Spot<T> | undefined
}

export interface SpotSubListReader<T> {

  readonly count: number

  readonly first?: Spot<T>

  readonly last?: Spot<T>

}

// SpotListRenovation / РеновацияСпотСписка

export interface SpotListRenovation<T> {

  mark: number

  list: SpotList<T>

  lookup(key: string | undefined): Spot<T> | undefined

  tryReuse(key: string,
    resolution?: { isDuplicate: boolean },
    error?: string): Spot<T> | undefined

  add(instance: T, before?: Spot<T>): Spot<T>

  remove(spot: Spot<T>): void

  move(spot: Spot<T>, before: Spot<T> | undefined): void

  markAsMoved(spot: Spot<T>): void

  added(): Generator<Spot<T>>

  removed(): Generator<Spot<T>>

}

export class SpotListRenovation$<T> implements SpotListRenovation<T> {

  private static markGen: number = 0

  mark: number

  list: SpotList<T>

  private actual$: SpotSubList$<T>

  private added$: Array<Spot$<T>> | undefined

  private unconfirmed$: SpotSubList$<T>

  private expectedNext: Spot$<T> | undefined

  private lastUnknownKey: string | undefined

  constructor(list: SpotList<T>, actual: SpotSubList$<T>, unconfirmed: SpotSubList$<T>) {
    this.mark = (SpotListRenovation$.markGen += MARK_MOD)
    this.list = list
    this.actual$ = actual
    this.added$ = undefined
    this.unconfirmed$ = unconfirmed
    this.expectedNext = unconfirmed.first
    this.lastUnknownKey = undefined
  }

  lookup(key: string | undefined): Spot<T> | undefined {
    let result: Spot<T> | undefined = undefined
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

  tryReuse(key: string, resolution?: { isDuplicate: boolean }, error?: string): Spot<T> | undefined {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse(error ?? "renovation is not in progress")
    let spot = this.expectedNext
    if (key !== (spot ? list.extractKey(spot.value) : undefined))
      spot = this.lookup(key) as Spot$<T> | undefined
    if (spot !== undefined) {
      const m = this.mark
      const distance = spot.mark$ - m
      if (distance < 0 || distance >= MARK_MOD) {
        if (list.isStrictChildrenOrder && spot !== this.expectedNext)
          spot.mark$ = m + Mark.moved
        else
          spot.mark$ = m + Mark.existing
        this.expectedNext = this.unconfirmed$.nextOf(spot)
        this.unconfirmed$.exclude(spot)
        spot.index = this.actual$.count
        this.actual$.include(spot)
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
    return spot
  }

  add(value: T, before?: Spot<T>): Spot<T> {
    const spot = this.list.add(value) as Spot$<T>
    const m = this.mark
    spot.mark$ = m > 0 ? m + Mark.added : m
    this.lastUnknownKey = undefined
    this.expectedNext = undefined
    spot.index = this.actual$.count
    let added = this.added$
    if (added == undefined)
      added = this.added$ = []
    added.push(spot)
    return spot
  }

  remove(spot: Spot<T>): void {
    const x = spot as Spot$<T>
    const m = this.mark
    x.mark$ = m + Mark.removed
  }

  move(spot: Spot<T>, before: Spot<T> | undefined): void {
    throw misuse("not implemented")
  }

  markAsMoved(spot: Spot<T>): void {
    if (!this.list.isRenovationInProgress)
      throw misuse("spot cannot be marked as moved outside of renovation cycle")
    const x = spot as Spot$<T>
    x.mark$ = this.mark + Mark.moved
  }

  *actual(): Generator<Spot<T>> {
    throw misuse("not implemented")
  }

  *added(): Generator<Spot<T>> {
    throw misuse("not implemented")
  }

  *removed(): Generator<Spot<T>> {
    throw misuse("not implemented")
  }

  done(error: unknown): void {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse("renovation is ended already")
    if (error === undefined) {
      for (const x of this.unconfirmed$.items()) {
        x.mark$ = this.mark + Mark.removed
        list.remove(x)
      }
    }
    else {
      this.actual$.grab(this.unconfirmed$, true)
      if (this.added$ !== undefined) {
        for (const x of this.added$) {
          list.remove(x)
        }
        this.added$ = undefined
      }
    }
  }

}

// SpotList / СпотДерево

export class SpotList<T> implements SpotListReader<T> {

  readonly extractKey: ExtractSpotKey<T>

  private isStrictOrder$: boolean

  private map: Map<string | undefined, Spot$<T>>

  private actual$: SpotSubList$<T>

  private unconfirmed$: SpotSubList$<T> | undefined

  constructor(extractKey: ExtractSpotKey<T>, isStrictOrder: boolean = false) {
    this.extractKey = extractKey
    this.isStrictOrder$ = isStrictOrder
    this.map = new Map<string | undefined, Spot$<T>>()
    this.actual$ = new SpotSubList$<T>()
    this.unconfirmed$ = undefined
  }

  get isStrictChildrenOrder(): boolean { return this.isStrictOrder$ }
  set isStrictChildrenOrder(value: boolean) {
    if (this.unconfirmed$ !== undefined)
      throw misuse("cannot change strict mode in the middle of renovation")
    this.isStrictOrder$ = value
  }

  get isRenovationInProgress(): boolean {
    return this.unconfirmed$ !== undefined
  }

  get count(): number {
    return this.actual$.count + (this.unconfirmed$?.count ?? 0)
  }

  get items(): SpotSubListReader<T> {
    return this.actual$
  }

  lookup(key: string | undefined): Spot<T> | undefined {
    return this.map.get(key)
  }

  add(value: T): Spot<T> {
    const key = this.extractKey(value)
    if (this.map.get(key) !== undefined)
      throw misuse(`key is already in use: ${key}`)
    const spot = new Spot$<T>(value, this, 0)
    this.map.set(key, spot)
    this.actual$.include(spot)
    return spot
  }

  remove(spot: Spot<T>): void {
    throw misuse("not implemented")
  }

  beginRenovation(): SpotListRenovation<T> {
    if (this.unconfirmed$ !== undefined)
      throw misuse("renovation is in progress already")
    const existing = this.actual$
    this.actual$ = new SpotSubList$<T>()
    return new SpotListRenovation$<T>(this, this.actual$, existing)
  }

  endRenovation(r: SpotListRenovation<T>, error?: unknown): void {
    const renovation = r as SpotListRenovation$<T>
    renovation.done(error)
    this.unconfirmed$ = undefined
  }

}

// Spot$

class Spot$<T> implements Spot<T> {

  readonly value: T

  list: SpotList<T>

  next?: Spot$<T>

  prev?: Spot$<T>

  aux?: Spot$<T>

  index: number

  mark$: number

  constructor(value: T, list: SpotList<T>, mark$: number) {
    this.value = value
    this.list = list
    this.next = undefined
    this.prev = undefined
    this.aux = undefined
    this.index = -1
    this.mark$ = mark$
  }

  get mark(): Mark {
    return this.mark$ % MARK_MOD
  }

}

// AbstractSpotSubList

abstract class AbstractSpotSubList<T> implements SpotSubListReader<T> {

  count: number = 0

  first?: Spot$<T> = undefined

  last?: Spot$<T> = undefined

  abstract nextOf(spot: Spot$<T>): Spot$<T> | undefined

  abstract setNextOf(spot: Spot$<T>, next: Spot$<T> | undefined): Spot$<T> | undefined

  abstract prevOf(spot: Spot$<T>): Spot$<T> | undefined

  abstract setPrevOf(spot: Spot$<T>, prev: Spot$<T> | undefined): Spot$<T> | undefined

  *items(): Generator<Spot$<T>> {
    let x = this.first
    while (x !== undefined) {
      const next = this.nextOf(x)
      yield x
      x = next
    }
  }

  include(spot: Spot$<T>, before?: Spot$<T>): void {
    const last = this.last
    this.setPrevOf(spot, last)
    this.setNextOf(spot, undefined)
    if (last !== undefined)
      this.last = this.setNextOf(last, spot)
    else
      this.first = this.last = spot
    this.count++
  }

  exclude(spot: Spot$<T>): void {
    const prev = this.prevOf(spot)
    if (prev !== undefined)
      this.setNextOf(prev, this.nextOf(spot))
    const next = this.nextOf(spot)
    if (next !== undefined)
      this.setPrevOf(next, this.prevOf(spot))
    if (spot === this.first)
      this.first = this.nextOf(spot)
    this.count--
  }

  clear(): void {
    this.count = 0
    this.first = undefined
    this.last = undefined
  }

}

// SpotSubList$

class SpotSubList$<T> extends AbstractSpotSubList<T> {

  override nextOf(spot: Spot$<T>): Spot$<T> | undefined {
    return spot.next
  }

  override setNextOf(spot: Spot$<T>, next: Spot$<T> | undefined): Spot$<T> | undefined {
    spot.next = next
    return next
  }

  override prevOf(spot: Spot$<T>): Spot$<T> | undefined {
    return spot.prev
  }

  override setPrevOf(spot: Spot$<T>, prev: Spot$<T> | undefined): Spot$<T> | undefined {
    spot.prev = prev
    return prev
  }

  grab(from: SpotSubList$<T>, join: boolean): void {
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

// SpotAuxSubList

class SpotAuxSubList$<T> extends AbstractSpotSubList<T> {

  override nextOf(spot: Spot$<T>): Spot$<T> | undefined {
    return spot.aux
  }

  override setNextOf(spot: Spot$<T>, next: Spot$<T> | undefined): Spot$<T> | undefined {
    spot.aux = next
    return next
  }

  override prevOf(spot: Spot$<T>): Spot$<T> | undefined {
    return undefined
  }

  override setPrevOf(spot: Spot$<T>, prev: Spot$<T> | undefined): Spot$<T> | undefined {
    return undefined
  }

}
