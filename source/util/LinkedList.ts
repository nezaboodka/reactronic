// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"

// ExtractItemKey / ИзвлечьКлючЭлемента

export type ExtractItemKey<T = unknown> = (node: T) => string | undefined

// Mark / Отметка

export enum Mark {

  existing = 0, // существующий

  added = 1,    // добавленный

  moved = 2,    // перемещённый

  removed = 3,  // удалённый

}

const MARK_MOD = 4

// CollectionReader / КоллекцияЧитаемая

export interface CollectionReader<T>
{
  count: number
  items(): Generator<T>
}

// LinkedList / СписокСвязанный

export class LinkedList<T> {

  readonly extractKey: ExtractItemKey<T>

  private isStrictOrder$: boolean

  private map: Map<string | undefined, Linked<T>>

  /* internal */ current$: LinkedSubList<T>

  /* internal */ former$: LinkedSubList<T> | undefined

  constructor(extractKey: ExtractItemKey<T>, isStrictOrder: boolean = false) {
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
    const t = item as Linked<T>
    const key = this.extractKey(item.value)
    if (this.map.get(key) !== undefined)
      throw misuse(`item with given key already exists: ${key}`)
    this.map.set(key, t)
    t.link$(this.current$, undefined)
  }

  remove(item: Linked<T>): void {
    throw misuse("not implemented")
  }

}

// Linked

export class Linked<T> {

  private list$: LinkedSubList<T> | undefined

  private next$: Linked<T> | undefined

  private prev$: Linked<T> | undefined

  get list(): LinkedSubList<T> | undefined { return this.list$ }

  get next(): Linked<T> | undefined { return this.next$ }

  get prev(): Linked<T> | undefined { return this.prev$ }

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

  get mark(): Mark {
    return this.mark$ % MARK_MOD
  }

  link$(list: LinkedSubList<T> | undefined, before: Linked<T> | undefined): void {
    if (before === undefined) {
      this.unlink()
      if (list !== undefined) {
        this.list$ = list
        const last = list.last
        this.prev$ = last
        this.next$ = undefined
        if (last !== undefined)
          list.last = last.next$ = this
        else
          list.first = list.last = this
        list.count++
      }
      else {
        this.list$ = undefined
        this.next$ = undefined
        this.prev$ = undefined
      }
    }
    else {
      if (list === undefined)
        list = before.list!
      else if (list !== before.list)
        throw misuse("sibling is not in the given list")
      this.unlink()
      const after = before.prev$
      this.prev$ = after
      this.next$ = before
      before.prev$ = this
      if (after !== undefined)
        after.next$ = this
      if (before == list.first)
        list.first = this
      this.list$ = list
      list.count++
    }
  }

  private unlink(): void {
    const list = this.list
    if (list) {
      const prev = this.prev$
      if (prev !== undefined)
        prev.next$ = this.next$
      const next = this.next$
      if (next !== undefined)
        next.prev$ = this.prev$
      if (this === list.first)
        list.first = this.next$
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
