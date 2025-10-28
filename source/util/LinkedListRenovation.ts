// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"
import { LinkedList, LinkedItem, LinkedSubList, Mark } from "./LinkedList.js"

// LinkedListRenovation<T>

export class LinkedListRenovation<T extends LinkedItem<T>> {

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
    this.expectedNext = lost.first
    this.lastUnknownKey = undefined
    this.changes = changes
  }

  // найти
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

  // это-продлено
  thisIsProlonged(key: string, resolution?: { isDuplicate: boolean }, error?: string): T | undefined {
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
        grabAllPrevSiblingsWhileManual(item, items)
        LinkedItem.link$(items, item, undefined)
        if (list.isStrictOrder && item !== this.expectedNext) {
          LinkedItem.setStatus$(item, Mark.modified, items.count)
          this.changes?.push(item)
        }
        else
          LinkedItem.setStatus$(item, Mark.prolonged, items.count)
        this.expectedNext = next
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

  // это-изменено
  thisIsModified(item: T): void {
    if (item.list !== this.list.items$)
      throw misuse("only prolonged items can be marked as modified")
    const m = item.mark
    if (m === Mark.prolonged)
      LinkedItem.setStatus$(item, Mark.modified, item.rank)
    else if (m !== Mark.modified)
      throw misuse("item is renovated already and cannot be marked as modified")
  }

  // это-добавлено
  thisIsAdded(item: T, before?: T): T {
    this.list.add(item, before)
    LinkedItem.setStatus$(item, Mark.added, this.list.items$.count)
    this.lastUnknownKey = undefined
    this.expectedNext = undefined
    this.changes?.push(item)
    return item
  }

  // это-удалено
  thisIsRemoved(item: T): void {
    if (item.list !== this.list.former$)
      throw misuse("cannot remove item which doesn't belong to former list")
    LinkedList.remove$(this.list, item)
    LinkedItem.setStatus$(item, Mark.removed, 0)
    this.changes?.push(item)
  }

  // это-перемещено
  thisIsMoved(item: T, before: T | undefined): void {
    if (item.list !== this.list.former$)
      throw misuse("cannot move item which doesn't belong to former list")
    LinkedList.move$(this.list, item, before)
    LinkedItem.setStatus$(item, Mark.modified, 0)
    this.changes?.push(item)
  }

  get lostItemCount(): number { return this.lost$.count }

  lostItems(): Generator<T> { return this.lost$.items() }

  done(error?: unknown): void {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse("renovation is ended already")
    const items = this.list.items$
    const lost = this.lost$
    if (error === undefined) {
      // Mark lost items
      for (const x of lost.items()) {
        if (!x.isManual) {
          LinkedList.removeKey$(list, list.keyOf(x))
          LinkedItem.setStatus$(x, Mark.removed, 0)
        }
        else // always prolong manual items
          LinkedItem.link$(items, x, undefined)
      }
    }
    else {
      // Prolong lost items in case of error
      for (const x of lost.items()) {
        LinkedItem.link$(items, x, undefined)
        LinkedItem.setStatus$(x, Mark.prolonged, items.count)
      }
    }
    list.former$ = undefined
  }

}

function grabAllPrevSiblingsWhileManual<T extends LinkedItem<T>>(
  item: T, list: LinkedSubList<T>): T | undefined {
  let x = item.prev
  let before: T | undefined = undefined
  while (x !== undefined && x.isManual) {
    LinkedItem.link$(list, x, before)
    before = x
    x = x.prev
  }
  return before
}
