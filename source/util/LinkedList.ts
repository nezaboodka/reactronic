// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"

// ExtractItemKey / ИзвлечьКлючЭлемента

export type ExtractItemKey<T = unknown> = (item: T) => string | undefined

// CollectionReader / КоллекцияЧитаемая

export interface CollectionReader<T>
{
  count: number
  items(): Generator<T>
}

// LinkedList / СписокСвязанный

export class LinkedList<T> {

  readonly extractKey: ExtractItemKey<Linked<T>>

  private isStrictOrder$: boolean

  private map: Map<string | undefined, Linked<T>>

  /* internal */
  current$: LinkedSubList<T>

  /* internal */
  former$: LinkedSubList<T> | undefined

  constructor(extractKey: ExtractItemKey<Linked<T>>, isStrictOrder: boolean = false) {
    this.extractKey = extractKey
    this.isStrictOrder$ = isStrictOrder
    this.map = new Map<string | undefined, Linked<T>>()
    this.current$ = new LinkedSubList<T>()
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
    return this.current$.count + (this.former$?.count ?? 0)
  }

  items(): Generator<Linked<T>> {
    return this.current$.items()
  }

  lookup(key: string | undefined): Linked<T> | undefined {
    return this.map.get(key)
  }

  add(item: Linked<T>): void {
    const key = this.extractKey(item)
    if (this.map.get(key) !== undefined)
      throw misuse(`item with given key already exists: ${key}`)
    this.map.set(key, item)
    Linked.link$(item, this.current$, undefined)
  }

  remove(item: Linked<T>): void {
    if (item.list !== this.current$ && item.list !== this.former$)
      throw misuse("given item doesn't belong to the given list")
    const key = this.extractKey(item)
    this.map.delete(key)
    Linked.link$(item, undefined, undefined)
  }

}

// Linked

export class Linked<T> {

  private list$: LinkedSubList<T> | undefined

  private next$: Linked<T> | undefined

  private prev$: Linked<T> | undefined

  value: T

  index$: number

  mark$: number

  constructor(value: T) {
    this.list$ = undefined
    this.next$ = undefined
    this.prev$ = undefined
    this.value = value
    this.index$ = -1
    this.mark$ = 0
  }

  get list(): LinkedSubList<T> | undefined { return this.list$ }

  get next(): Linked<T> | undefined { return this.next$ }

  get prev(): Linked<T> | undefined { return this.prev$ }

  // Internal

  static link$<T>(item: Linked<T>,
    list: LinkedSubList<T> | undefined,
    before: Linked<T> | undefined): void {
    if (before === undefined) {
      Linked.unlink(item)
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
        Linked.unlink(item)
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

  private static unlink<T>(item: Linked<T>): void {
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

export class LinkedSubList<T> {

  count: number = 0

  first?: Linked<T> = undefined

  last?: Linked<T> = undefined;

  *items(): Generator<Linked<T>> {
    let x = this.first
    while (x !== undefined) {
      const next = x.next
      yield x
      x = next
    }
  }

  // include(item: Linked$<T>, before?: Linked$<T>): void {
  //   const last = this.last
  //   item.link$(this, last, undefined)
  //   if (last !== undefined)
  //     this.last = last.next = item
  //   else
  //     this.first = this.last = item
  //   this.count++
  // }

  // exclude(item: Linked$<T>): void {
  //   const prev = item.prev
  //   if (prev !== undefined)
  //     prev.next = item.next
  //   const next = item.next
  //   if (next !== undefined)
  //     next.prev = item.prev
  //   if (item === this.first)
  //     this.first = item.next
  //   this.count--
  // }

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
