// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"
import { LinkedList, LinkedSubList, Linked, Mark } from "./LinkedList.js"

// LinkedListRenovation

export class LinkedListRenovation<T> {

  list: LinkedList<T>

  private current$: LinkedSubList<T>

  private added$: Array<Linked<T>> | undefined

  private former$: LinkedSubList<T>

  private expectedNext: Linked<T> | undefined

  private lastUnknownKey: string | undefined

  constructor(list: LinkedList<T>) {
    if (list.former$ !== undefined)
      throw misuse("renovation is in progress already")
    const former = list.current$
    const current = list.current$ = new LinkedSubList<T>()
    this.list = list
    this.current$ = current
    this.added$ = undefined
    this.former$ = former
    this.expectedNext = former.first
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
      item = this.lookup(key) as Linked<T> | undefined
    if (item !== undefined) {
      if (item.list !== this.current$) {
        if (list.isStrictOrder && item !== this.expectedNext)
          item.mark$ = Mark.moved
        else
          item.mark$ = Mark.existing
        this.expectedNext = item.next
        item.link$(this.current$, undefined)
        item.index = this.current$.count - 1
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
    const t = item as Linked<T>
    this.list.add(item)
    t.mark$ = Mark.added
    this.lastUnknownKey = undefined
    this.expectedNext = undefined
    t.index = this.current$.count
    let added = this.added$
    if (added == undefined)
      added = this.added$ = []
    added.push(t)
    return item
  }

  remove(item: Linked<T>): void {
    this.list.remove(item)
    const x = item as Linked<T>
    x.mark$ = Mark.removed
  }

  move(item: Linked<T>, before: Linked<T> | undefined): void {
    throw misuse("not implemented")
  }

  setMark(item: Linked<T>, value: Mark): void {
    if (!this.list.isRenovationInProgress)
      throw misuse("item cannot be marked outside of renovation cycle")
    const x = item as Linked<T>
    x.mark$ = value
  }

  get currentCount(): number {
    return this.current$.count
  }

  current(): Generator<Linked<T>> {
    return this.current$.items()
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

  get disappearedCount(): number {
    return this.former$.count
  }

  disappeared(): Generator<Linked<T>> {
    return this.former$.items()
  }

  done(error: unknown): void {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse("renovation is ended already")
    if (error === undefined) {
      for (const x of this.former$.items()) {
        x.mark$ = Mark.removed
        list.remove(x)
      }
    }
    else {
      this.current$.grab(this.former$, true)
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
