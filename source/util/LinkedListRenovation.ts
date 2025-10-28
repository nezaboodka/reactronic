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

  readonly list: LinkedList<T> // список

  readonly diff: Array<T> | undefined // дельта

  private lost$: LinkedSubList<T>

  private expected: T | undefined

  private absent: string | undefined

  constructor(list: LinkedList<T>, diff?: Array<T>) {
    if (list.former$ !== undefined)
      throw misuse("renovation is in progress already")
    const former = list.items$
    this.list = list
    this.diff = diff
    this.lost$ = former
    this.expected = former.first
    this.absent = undefined
    list.former$ = former
    list.items$ = new LinkedSubList<T>()
  }

  // найти
  lookup(key: string | undefined): T | undefined {
    let result: T | undefined = undefined
    if (key !== undefined && key !== this.absent) {
      result = this.list.lookup(key)
      if (result !== undefined) {
        if (this.list.keyOf(result) !== key) {
          this.absent = key
          result = undefined
        }
      }
      else
        this.absent = key
    }
    return result
  }

  // попробовать-продлить
  tryToProlonge(key: string, resolution?: { isDuplicate: boolean }, error?: string): T | undefined {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse(error ?? "renovation is no longer in progress")
    let x = this.expected
    if (key !== (x ? list.keyOf(x) : undefined))
      x = this.lookup(key)
    if (x !== undefined) {
      const result = this.list.items$
      if (x.list !== result) {
        const next = x.next // remember before re-linking
        const expected = prolongExternalsIfAny(result, x) ?? x
        LinkedItem.link$(result, x, undefined)
        if (list.isStrictOrder && expected !== this.expected) {
          LinkedItem.setStatus$(x, Mark.modified, result.count)
          this.diff?.push(x)
        }
        else
          LinkedItem.setStatus$(x, Mark.prolonged, result.count)
        this.expected = next
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
    return x
  }

  // это-добавлено
  thisIsAdded(item: T, before?: T): T {
    this.list.add(item, before)
    LinkedItem.setStatus$(item, Mark.added, this.list.items$.count)
    this.absent = undefined
    this.expected = undefined
    this.diff?.push(item)
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

  // это-перемещено
  thisIsMoved(item: T, before: T | undefined): void {
    if (item.list !== this.list.former$)
      throw misuse("cannot move item which doesn't belong to former list")
    LinkedList.move$(this.list, item, before)
    LinkedItem.setStatus$(item, Mark.modified, 0)
    this.diff?.push(item)
  }

  // это-удалено
  thisIsRemoved(item: T): void {
    if (item.list !== this.list.former$)
      throw misuse("cannot remove item which doesn't belong to former list")
    LinkedList.remove$(this.list, item)
    LinkedItem.setStatus$(item, Mark.removed, 0)
    this.diff?.push(item)
  }

  // количество-утерянных-элементов
  get lostItemCount(): number { return this.lost$.count }

  // утерянные-элементы
  lostItems(): Generator<T> { return this.lost$.items() }

  // готово
  done(error?: unknown): void {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse("renovation is ended already")
    const items = this.list.items$
    const lost = this.lost$
    if (error === undefined) {
      // Mark lost items
      for (const x of lost.items()) {
        if (!x.isExternal) {
          LinkedList.removeKey$(list, list.keyOf(x))
          LinkedItem.setStatus$(x, Mark.removed, 0)
        }
        else // always prolong external items
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

function prolongExternalsIfAny<T extends LinkedItem<T>>(
  list: LinkedSubList<T>, item: T): T | undefined {
  let x = item.prev
  let before: T | undefined = undefined
  while (x !== undefined && x.isExternal) {
    LinkedItem.link$(list, x, before)
    before = x
    x = x.prev
  }
  return before
}
