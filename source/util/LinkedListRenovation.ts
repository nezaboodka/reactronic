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

  private expectedNext: T | undefined

  private lastUnknownKey: string | undefined

  readonly changes: Array<T> | undefined

  constructor(list: LinkedList<T>, changes?: Array<T>) {
    if (list.former$ !== undefined)
      throw misuse("renovation is in progress already")
    const items = new LinkedSubList<T>()
    const lost = list.items$
    this.list = list
    list.items$ = items
    list.former$ = lost
    this.lost$ = lost
    this.expectedNext = grabManualSiblings(lost.first, items)
    this.lastUnknownKey = undefined
    this.changes = changes
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
        if (list.isStrictOrder && item !== this.expectedNext) {
          Linked.setStatus$(item, Mark.modified, items.count)
          this.changes?.push(item)
        }
        else
          Linked.setStatus$(item, Mark.reused, items.count)
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

  markModified(item: T): void {
    if (item.list !== this.list.items$)
      throw misuse("only reused items can be marked as modified")
    const m = item.mark
    if (m === Mark.reused)
      Linked.setStatus$(item, Mark.modified, item.rank)
    else if (m !== Mark.modified)
      throw misuse("item is renovated already and cannot be marked as modified")
  }

  add(item: T, before?: T): T {
    this.list.add(item, before)
    Linked.setStatus$(item, Mark.added, this.list.items$.count)
    this.lastUnknownKey = undefined
    this.expectedNext = undefined
    this.changes?.push(item)
    return item
  }

  remove(item: T): void {
    if (item.list !== this.list.former$)
      throw misuse("cannot remove item which doesn't belong to former list")
    LinkedList.remove$(this.list, item)
    Linked.setStatus$(item, Mark.removed, 0)
    this.changes?.push(item)
  }

  move(item: T, before: T | undefined): void {
    if (item.list !== this.list.former$)
      throw misuse("cannot move item which doesn't belong to former list")
    LinkedList.move$(this.list, item, before)
    Linked.setStatus$(item, Mark.modified, 0)
    this.changes?.push(item)
  }

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
        LinkedList.removeKey$(list, list.keyOf(x))
        Linked.setStatus$(x, Mark.removed, 0)
      }
    }
    else {
      // Restore lost items in case of error
      const items = this.list.items$
      for (const x of lost.items()) {
        Linked.link$(x, items, undefined)
        Linked.setStatus$(x, Mark.reused, items.count)
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
