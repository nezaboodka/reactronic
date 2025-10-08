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

export type GetSpotKey<T = unknown> = (payload: T) => string | undefined

export interface Spot<T> {
  readonly payload: T
  readonly owner: Spot<T>
  readonly index: number
  readonly next?: Spot<T>
  readonly prev?: Spot<T>
  readonly mark: Mark
}

// SpotTreeReader / СпотДеревоЧитаемое

export interface SpotTreeReader<T> {
  readonly isStrict: boolean
  readonly actual: SpotSubTreeReader<T>
  readonly addedDuringUpdate: SpotSubTreeReader<T>
  readonly removedDuringUpdate: SpotSubTreeReader<T>
  lookup(key: string): Spot<T> | undefined
}

// SpotTreeUpdater / СпотДеревоОбновляемое

export interface SpotTreeUpdater<T> {
  readonly isUpdateInProgress: boolean
  beginUpdate(): void
  endUpdate(error?: unknown): void
  tryReuse(key: string, resolution?: { isDuplicate: boolean }, error?: string): Spot<T> | undefined
  add(instance: T, before?: Spot<T>): Spot<T>
  remove(spot: Spot<T>): void
  move(spot: Spot<T>, before: Spot<T> | undefined): void
  markAsMoved(spot: Spot<T>): void
  clearAddedAndRemoved(): void
}

export interface SpotSubTreeReader<T> {
  readonly count: number
  readonly first?: Spot<T>
  readonly last?: Spot<T>
}

// SpotTree / СпотДерево

export class SpotTree<T> implements SpotTreeReader<T> {
  readonly getKey: GetSpotKey<T>
  private isStrict$: boolean
  private map: Map<string | undefined, Spot$<T>>
  private mark$: number
  private actual$: SpotSubTree$<T>
  private addedDuringUpdate$: SpotAuxSubTree$<T>
  private removedDuringUpdate$: SpotSubTree$<T>
  private lastNotFoundKey: string | undefined
  private expectedNextSpot?: Spot$<T>

  constructor(getKey: GetSpotKey<T>, isStrict: boolean = false) {
    this.getKey = getKey
    this.isStrict$ = isStrict
    this.map = new Map<string | undefined, Spot$<T>>()
    this.mark$ = ~1
    this.actual$ = new SpotSubTree$<T>()
    this.addedDuringUpdate$ = new SpotAuxSubTree$<T>()
    this.removedDuringUpdate$ = new SpotSubTree$<T>()
    this.lastNotFoundKey = undefined
    this.expectedNextSpot = undefined
  }

  get isStrict(): boolean { return this.isStrict$ }
  set isStrict(value: boolean) {
    if (this.mark$ > 0)
      throw misuse("cannot change strict mode in the middle of update")
    this.isStrict$ = value
  }

  get isUpdateInProgress(): boolean {
    return this.mark$ > 0
  }

  get actual(): SpotSubTreeReader<T> {
    return this.actual$
  }

  get addedDuringUpdate(): SpotSubTreeReader<T> {
    return this.addedDuringUpdate$
  }

  get removedDuringUpdate(): SpotSubTreeReader<T> {
    return this.removedDuringUpdate$
  }

  lookup(key: string | undefined): Spot<T> | undefined {
    let result: Spot<T> | undefined = undefined
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

  beginUpdate(): void {
    const m = this.mark$
    if (m > 0)
      throw misuse("update is in progress already")
    this.mark$ = ~m + MARK_MOD
    this.expectedNextSpot = this.actual$.first
    this.removedDuringUpdate$.grab(this.actual$, false)
    this.addedDuringUpdate$.clear()
  }

  endUpdate(error?: unknown): void {
    const m = this.mark$
    if (m <= 0)
      throw misuse("update is ended already")
    if (error === undefined) {
      const getKey = this.getKey
      const map = this.map
      for (const x of this.removedDuringUpdate$.items()) {
        x.mark$ = m + Mark.removed
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
    this.mark$ = ~m
  }

  tryReuse(key: string, resolution?: { isDuplicate: boolean }, error?: string): Spot<T> | undefined {
    const m = this.mark$
    if (m <= 0)
      throw misuse(error ?? "update is not in progress")
    let spot = this.expectedNextSpot
    if (key !== (spot ? this.getKey(spot.payload) : undefined))
      spot = this.lookup(key) as Spot$<T> | undefined
    if (spot !== undefined) {
      const distance = spot.mark$ - m
      if (distance < 0 || distance >= MARK_MOD) {
        if (this.isStrict$ && spot !== this.expectedNextSpot)
          spot.mark$ = m + Mark.moved
        else
          spot.mark$ = m + Mark.existing
        this.expectedNextSpot = this.removedDuringUpdate$.nextOf(spot)
        this.removedDuringUpdate$.exclude(spot)
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

  add(instance: T, before?: Spot<T>): Spot<T> {
    const key = this.getKey(instance)
    if (this.lookup(key) !== undefined)
      throw misuse(`key is already in use: ${key}`)
    const m = this.mark$
    const spot = new Spot$<T>(instance,
      m > 0 ? m + Mark.added : m)
    this.map.set(key, spot)
    this.lastNotFoundKey = undefined
    this.expectedNextSpot = undefined
    spot.index = this.actual$.count
    this.actual$.include(spot, before as Spot$<T>)
    if (m > 0) // update is in progress
      this.addedDuringUpdate$.include(spot)
    return spot
  }

  remove(spot: Spot<T>): void {
    if (spot.mark !== Mark.removed) {
      const x = spot as Spot$<T>
      this.actual$.exclude(x)
      const m = this.mark$
      if (m > 0) { // update is in progress
        this.removedDuringUpdate$.include(x)
        x.mark$ = m + Mark.removed
      }
    }
  }

  move(spot: Spot<T>, before: Spot<T> | undefined): void {
    throw misuse("not implemented")
  }

  markAsMoved(spot: Spot<T>): void {
    const m = this.mark$
    if (m <= 0) // update is not in progress
      throw misuse("spot cannot be marked as moved outside of update cycle")
    const x = spot as Spot$<T>
    x.mark$ = m + Mark.moved
  }

  clearAddedAndRemoved(): void {
    this.addedDuringUpdate$.clear()
    this.removedDuringUpdate$.clear()
  }

  static createSpot<T>(payload: T): Spot<T> {
    return new Spot$<T>(payload, 0)
  }
}

// Spot$

class Spot$<T> implements Spot<T> {
  readonly payload: T
  owner: Spot$<T>
  index: number
  next?: Spot$<T>
  prev?: Spot$<T>
  aux?: Spot$<T>
  mark$: number

  constructor(payload: T, mark$: number) {
    this.payload = payload
    this.owner = this
    this.index = -1
    this.next = undefined
    this.prev = undefined
    this.aux = undefined
    this.mark$ = mark$
  }

  get mark(): Mark {
    return this.mark$ % MARK_MOD
  }
}

// AbstractSpotSubTree

abstract class AbstractSpotSubTree<T> implements SpotSubTreeReader<T> {
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

// SpotSubTree$

class SpotSubTree$<T> extends AbstractSpotSubTree<T> {
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

  grab(from: SpotSubTree$<T>, join: boolean): void {
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

// SpotAuxSubTree

class SpotAuxSubTree$<T> extends AbstractSpotSubTree<T> {
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
