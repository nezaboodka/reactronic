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
  former$: LinkedSubList<T> | undefined

  constructor(
    keyExtractor: KeyExtractor<T>,
    isStrictOrder: boolean = false) {
    this.keyOf = keyExtractor
    this.isStrictOrder$ = isStrictOrder
    this.map = new Map<string | undefined, T>()
    this.items$ = new LinkedSubList<T>()
    this.former$ = undefined
  }

  get isStrictOrder(): boolean { return this.isStrictOrder$ }
  set isStrictOrder(value: boolean) {
    if (this.former$ !== undefined)
      throw misuse("cannot change strict mode in the middle of renovation")
    this.isStrictOrder$ = value
  }

  get isRenovationInProgress(): boolean {
    return this.former$ !== undefined
  }

  get count(): number {
    return this.items$.count + (this.former$?.count ?? 0)
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
    if (!item.isExternal)
      throw misuse("cannot move non-external item outside of renovation cycle")
    LinkedList.move$(this, item, before)
  }

  remove(item: T): void {
    if (item.list !== this.items$)
      throw misuse("cannot remove item that belongs to another list")
    if (!item.isExternal)
      throw misuse("cannot remove non-external item outside of renovation cycle")
    LinkedList.remove$(this, item)
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

  get isExternal(): boolean { return this.status === 0 }

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
