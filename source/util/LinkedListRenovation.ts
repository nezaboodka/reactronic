// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"
import { LinkedList, Linked, LinkedSubList, Mark } from "./LinkedList.js"

// LinkedListRenovation<T>

export class LinkedListRenovation<T extends Linked<T>> {

  readonly list: LinkedList<T>

  private lost$: LinkedSubList<T>

  private changes$: Array<T>

  private expectedNext: T | undefined

  private lastUnknownKey: string | undefined

  constructor(list: LinkedList<T>) {
    if (list.former$ !== undefined)
      throw misuse("renovation is in progress already")
    const items = new LinkedSubList<T>()
    const lost = list.items$
    this.list = list
    list.items$ = items
    list.former$ = lost
    this.lost$ = lost
    this.changes$ = []
    this.expectedNext = grabManualSiblings(lost.first, items)
    this.lastUnknownKey = undefined
  }

  lookup(key: string | undefined): T | undefined {
    let result: T | undefined = undefined
    if (key !== undefined && key !== this.lastUnknownKey) {
      result = this.list.lookup(key)
      if (result !== undefined) {
        if (this.list.keyOf(result) !== key) {
          this.lastUnknownKey = key
          result = undefined
        }
      }
      else
        this.lastUnknownKey = key
    }
    return result
  }

  tryReuse(key: string, resolution?: { isDuplicate: boolean }, error?: string): T | undefined {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse(error ?? "renovation is no longer in progress")
    let item = this.expectedNext
    if (key !== (item ? list.keyOf(item) : undefined))
      item = this.lookup(key)
    if (item !== undefined) {
      const items = this.list.items$
      if (item.list !== items) {
        const next = item.next // remember before re-linking
        Linked.link$(item, items, undefined)
        if (list.isStrictOrder && item !== this.expectedNext)
          Linked.setStatus$(item, Mark.moved, items.count)
        else
          Linked.setStatus$(item, Mark.found, items.count)
        this.expectedNext = grabManualSiblings(next, items)
        if (resolution)
          resolution.isDuplicate = false
      }
      else if (resolution)
        resolution.isDuplicate = true
      else
        throw misuse(`duplicate linked item key: ${key}`)
    }
    else if (resolution)
      resolution.isDuplicate = false
    return item
  }

  add(item: T, before?: T): T {
    this.list.add(item)
    Linked.setStatus$(item, Mark.added, this.list.items$.count)
    this.lastUnknownKey = undefined
    this.expectedNext = undefined
    this.changes$.push(item)
    return item
  }

  remove(item: T): void {
    this.list.remove(item)
    Linked.setStatus$(item, Mark.removed, 0)
  }

  move(item: T, before: T | undefined): void {
    this.list.move(item, before)
    Linked.setStatus$(item, Mark.moved, 0)
  }

  // get addedCount(): number {
  //   return this.changes$?.length ?? 0
  // }

  // *added(): Generator<T> {
  //   const added = this.changes$
  //   if (added !== undefined)
  //     for (const x of added)
  //       yield x
  // }

  get lostCount(): number {
    return this.lost$.count
  }

  lost(): Generator<T> {
    return this.lost$.items()
  }

  done(error?: unknown): void {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse("renovation is ended already")
    const lost = this.lost$
    if (error === undefined) {
      // Mark lost items
      for (const x of lost.items()) {
        LinkedList.deleteKey$(list, x)
        Linked.setStatus$(x, Mark.lost, 0)
      }
    }
    else {
      // Restore lost items in case of error
      const items = this.list.items$
      for (const x of lost.items()) {
        Linked.link$(x, items, undefined)
        Linked.setStatus$(x, Mark.found, items.count)
      }
    }
    list.former$ = undefined
  }

}

function grabManualSiblings<T extends Linked<T>>(
  item: T | undefined,
  list: LinkedSubList<T>): T | undefined {
  while (item !== undefined && item.isManual) {
    Linked.link$(item, list, undefined)
    item = item.next
  }
  return item
}
