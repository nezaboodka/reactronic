// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"

// Extractor

export type Extractor<T, Result> = (item: T) => Result

export type KeyExtractor<T> = Extractor<T, string | undefined>

// LinkedList / СписокСвязанный

export class LinkedList<T extends LinkedItem<T>> {

  readonly keyOf: KeyExtractor<T>

  private isStrictOrder$: boolean

  private map: Map<string | undefined, T>

  /* internal */
  items$: LinkedSubList<T>

  /* internal */
  private renovation$: LinkedListRenovation<T> | undefined

  constructor(
    keyExtractor: KeyExtractor<T>,
    isStrictOrder: boolean = false) {
    this.keyOf = keyExtractor
    this.isStrictOrder$ = isStrictOrder
    this.map = new Map<string | undefined, T>()
    this.items$ = new LinkedSubList<T>()
    this.renovation$ = undefined
  }

  get isStrictOrder(): boolean { return this.isStrictOrder$ }
  set isStrictOrder(value: boolean) {
    if (this.renovation$ !== undefined)
      throw misuse("cannot change strict mode in the middle of renovation")
    this.isStrictOrder$ = value
  }

  get renovation(): LinkedListRenovation<T> {
    const r = this.renovation$
    if (r === undefined)
      throw misuse("renovation is not in progress")
    return r
  }

  get isRenovationInProgress(): boolean {
    return this.renovation$ !== undefined
  }

  get count(): number {
    return this.items$.count + (this.renovation$?.lostItemCount ?? 0)
  }

  items(): Generator<T> {
    return this.items$.items()
  }

  lookup(key: string | undefined): T | undefined {
    return this.map.get(key)
  }

  add(item: T, before?: T): void {
    const key = this.keyOf(item)
    if (this.map.get(key) !== undefined)
      throw misuse(`item with given key already exists: ${key}`)
    this.map.set(key, item)
    LinkedItem.link$(this.items$, item, before)
  }

  move(item: T, before: T | undefined): void {
    if (item.list !== this.items$)
      throw misuse("cannot move item that belongs to another list")
    if (!item.isManagedExternally)
      throw misuse("cannot move given item outside of renovation cycle")
    LinkedList.move$(this, item, before)
  }

  remove(item: T): void {
    if (item.list !== this.items$)
      throw misuse("cannot remove item that belongs to another list")
    if (!item.isManagedExternally)
      throw misuse("cannot remove given item outside of renovation cycle")
    LinkedList.remove$(this, item)
  }

  beginRenovation(diff?: Array<T>): LinkedListRenovation<T> {
    if (this.renovation$ !== undefined)
      throw misuse("renovation is in progress already")
    const former = this.items$
    const renovation = new LinkedListRenovation<T>(this, former, diff)
    this.items$ = new LinkedSubList<T>()
    this.renovation$ = renovation
    return renovation
  }

  endRenovation(error?: unknown): void {
    const renovation = this.renovation$
    if (renovation === undefined)
      throw misuse("renovation is ended already")
    const items = this.items$
    if (error === undefined) {
      // Mark lost items
      for (const x of renovation.lostItems()) {
        if (!x.isManagedExternally) {
          LinkedList.removeKey$(this, this.keyOf(x))
          LinkedItem.setStatus$(x, Mark.removed, 0)
        }
        else // always prolong externally managed items
          LinkedItem.link$(items, x, undefined)
      }
    }
    else {
      // Prolong lost items in case of error
      for (const x of renovation.lostItems()) {
        LinkedItem.link$(items, x, undefined)
        LinkedItem.setStatus$(x, Mark.prolonged, items.count)
      }
    }
    this.renovation$ = undefined
  }

  // Internal

  static move$<T extends LinkedItem<T>>(list: LinkedList<T>, item: T, before: T | undefined): void {
    LinkedItem.link$(list.items$, item, before)
  }

  static remove$<T extends LinkedItem<T>>(list: LinkedList<T>, item: T): void {
    LinkedList.removeKey$(list, list.keyOf(item))
    LinkedItem.link$(undefined, item, undefined)
  }

  static removeKey$<T extends LinkedItem<T>>(list: LinkedList<T>, key: string | undefined): void {
    list.map.delete(key)
  }

}

// Mark / Отметка

export enum Mark {

  prolonged = 0,  // продлено

  added = 1,      // добавлено

  modified = 2,   // изменено

  removed = 3,    // удалено

}

const MARK_MOD = 4

// LinkedItem / СвязанныйЭлемент

export class LinkedItem<T extends LinkedItem<T>> {

  private list$: LinkedSubList<T> | undefined

  private next$: T | undefined

  private prev$: T | undefined

  private status: number

  constructor() {
    this.list$ = undefined
    this.next$ = undefined
    this.prev$ = undefined
    this.status = 0
  }

  get list(): LinkedSubList<T> | undefined { return this.list$ }

  get next(): T | undefined { return this.next$ }

  get prev(): T | undefined { return this.prev$ }

  get mark(): Mark { return this.status % MARK_MOD }

  get rank(): number { return Math.trunc(this.status / MARK_MOD) }

  get isManagedExternally(): boolean { return this.status === 0 }

  // Internal

  static setStatus$<T extends LinkedItem<T>>(item: T, mark: Mark, rank: number): void {
    item.status = rank * MARK_MOD + mark
  }

  static link$<T extends LinkedItem<T>>(
    list: LinkedSubList<T> | undefined,
    item: T, before: T | undefined): void {
    if (before === undefined) {
      LinkedItem.unlink(item)
      if (list !== undefined) {
        // Link to another list
        item.list$ = list
        const last = list.last
        item.prev$ = last
        item.next$ = undefined
        if (last !== undefined)
          list.last = last.next$ = item
        else
          list.first = list.last = item
        list.count++
      }
      else {
        // Leave item fully unlinked
        item.list$ = undefined
        item.next$ = undefined
        item.prev$ = undefined
      }
    }
    else {
      if (list === before.list && list !== undefined) {
        LinkedItem.unlink(item)
        // Link to another list
        const after = before.prev$
        item.prev$ = after
        item.next$ = before
        before.prev$ = item
        if (after !== undefined)
          after.next$ = item
        if (before == list.first)
          list.first = item
        item.list$ = list
        list.count++
      }
      else {
        // Check invariants
        if (list !== before.list)
          throw misuse("sibling is not in the given list")
        else if (before.list === undefined)
          throw misuse("cannot link to sibling that is not in a list")
        else
          throw misuse("linked list invariant is broken")
      }
    }
  }

  private static unlink<T extends LinkedItem<T>>(item: T): void {
    const list = item.list
    if (list) {
      // Configure item
      const prev = item.prev$
      if (prev !== undefined)
        prev.next$ = item.next$
      const next = item.next$
      if (next !== undefined)
        next.prev$ = item.prev$
      // Configure list
      if (item === list.first)
        list.first = item.next$
      if (item === list.last)
        list.last = undefined
      list.count--
    }
  }

}

// LinkedSubList

export class LinkedSubList<T extends LinkedItem<T>> {

  count: number = 0

  first?: T = undefined

  last?: T = undefined;

  *items(): Generator<T> {
    let x = this.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
  }

  clear(): void {
    this.count = 0
    this.first = undefined
    this.last = undefined
  }

  grab(from: LinkedSubList<T>, join: boolean): void {
    const head = from.first
    if (join !== undefined && head !== undefined) {
      // const last = this.last
      // head.prev$ = last
      // if (last !== undefined)
      //   this.last = last.next$ = head
      // else
      //   this.first = this.last = head
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

// LinkedListRenovation<T>

export class LinkedListRenovation<T extends LinkedItem<T>> {

  readonly list: LinkedList<T> // список

  readonly diff: Array<T> | undefined // дельта

  private former: LinkedSubList<T>

  private expected: T | undefined

  private absent: string | undefined

  constructor(list: LinkedList<T>, former: LinkedSubList<T>, diff?: Array<T>) {
    this.list = list
    this.diff = diff
    this.former = former
    this.expected = former.first
    this.absent = undefined
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
  tryToProlong(key: string, resolution?: { isDuplicate: boolean }, error?: string): T | undefined {
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
        const expected = grabExternalIfAny(result, x) ?? x
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
    if (item.list !== this.former)
      throw misuse("cannot move item which doesn't belong to former list")
    LinkedList.move$(this.list, item, before)
    LinkedItem.setStatus$(item, Mark.modified, 0)
    this.diff?.push(item)
  }

  // это-удалено
  thisIsRemoved(item: T): void {
    if (item.list !== this.former)
      throw misuse("cannot remove item which doesn't belong to former list")
    LinkedList.remove$(this.list, item)
    LinkedItem.setStatus$(item, Mark.removed, 0)
    this.diff?.push(item)
  }

  // количество-утерянных-элементов
  get lostItemCount(): number { return this.former.count }

  // утерянные-элементы
  lostItems(): Generator<T> { return this.former.items() }

}

function grabExternalIfAny<T extends LinkedItem<T>>(
  list: LinkedSubList<T>, item: T): T | undefined {
  let x = item.prev
  let before: T | undefined = undefined
  while (x !== undefined && x.isManagedExternally) {
    LinkedItem.link$(list, x, before)
    before = x
    x = x.prev
  }
  return before
}
