// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"
import { LinkedList, Linked, LinkedSubList } from "./LinkedList.js"

// Mark / Отметка

export enum Mark {

  existing = 0, // существующий

  added = 1,    // добавленный

  moved = 2,    // перемещённый

  removed = 3,  // удалённый

}

const MARK_MOD = 4

// LinkedListRenovation<T>

export class LinkedListRenovation<T> {

  readonly list: LinkedList<T>

  private confirmed$: LinkedSubList<T>

  private unconfirmed$: LinkedSubList<T>

  private added$: Array<Linked<T>> | undefined

  private expectedNext: Linked<T> | undefined

  private lastUnknownKey: string | undefined

  constructor(list: LinkedList<T>) {
    if (list.former$ !== undefined)
      throw misuse("renovation is in progress already")
    const confirmed = new LinkedSubList<T>()
    const unconfirmed = list.current$
    this.list = list
    list.current$ = confirmed
    this.confirmed$ = confirmed
    list.former$ = unconfirmed
    this.unconfirmed$ = unconfirmed
    this.added$ = undefined
    this.expectedNext = unconfirmed.first
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
      item = this.lookup(key)
    if (item !== undefined) {
      const current = this.confirmed$
      if (item.list !== current) {
        this.expectedNext = item.next
        if (list.isStrictOrder && item !== this.expectedNext)
          item.mark$ = Mark.moved
        else
          item.mark$ = Mark.existing
        item.index$ = current.count
        Linked.link$(item, current, undefined)
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

  add(item: Linked<T>, before?: Linked<T>): Linked<T> {
    this.list.add(item)
    item.mark$ = Mark.added
    this.lastUnknownKey = undefined
    this.expectedNext = undefined
    item.index$ = this.confirmed$.count
    let added = this.added$
    if (added == undefined)
      added = this.added$ = []
    added.push(item)
    return item
  }

  remove(item: Linked<T>): void {
    this.list.remove(item)
    item.mark$ = Mark.removed
  }

  move(item: Linked<T>, before: Linked<T> | undefined): void {
    throw misuse("not implemented")
  }

  setMark(item: Linked<T>, value: Mark): void {
    if (!this.list.isRenovationInProgress)
      throw misuse("item cannot be marked outside of renovation cycle")
    item.mark$ = value
  }

  getMark(item: Linked<T>): Mark {
    return item.mark$ % MARK_MOD
  }

  get confirmedCount(): number {
    return this.confirmed$.count
  }

  confirmed(): Generator<Linked<T>> {
    return this.confirmed$.items()
  }

  get addedCount(): number {
    return this.added$?.length ?? 0
  }

  *added(): Generator<Linked<T>> {
    const added = this.added$
    if (added !== undefined)
      for (const x of added)
        yield x
  }

  get unconfirmedCount(): number {
    return this.unconfirmed$.count
  }

  unconfirmed(): Generator<Linked<T>> {
    return this.unconfirmed$.items()
  }

  done(error: unknown): void {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse("renovation is ended already")
    if (error === undefined) {
      for (const x of this.unconfirmed$.items()) {
        x.mark$ = Mark.removed
        list.remove(x)
      }
    }
    else {
      this.confirmed$.grab(this.unconfirmed$, true)
      if (this.added$ !== undefined) {
        for (const x of this.added$) {
          list.remove(x)
        }
        this.added$ = undefined
      }
    }
    list.former$ = undefined
  }

}
