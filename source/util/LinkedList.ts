// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"
import { ExtractItemKey, Mark, Linked, AbstractLinkedList, LinkedListRenovation } from "./LinkedList.defs.js"

const MARK_MOD = 4

// LinkedList / СписокСвязанный

export class LinkedList<T> implements AbstractLinkedList<T> {

  readonly extractKey: ExtractItemKey<T>

  private isStrictOrder$: boolean

  private map: Map<string | undefined, Linked$<T>>

  private current$: LinkedSubList$<T>

  private former$: LinkedSubList$<T> | undefined

  constructor(extractKey: ExtractItemKey<T>, isStrictOrder: boolean = false) {
    this.extractKey = extractKey
    this.isStrictOrder$ = isStrictOrder
    this.map = new Map<string | undefined, Linked$<T>>()
    this.current$ = new LinkedSubList$<T>()
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
    const t = item as Linked$<T>
    const key = this.extractKey(item.value)
    if (this.map.get(key) !== undefined)
      throw misuse(`item with given key already exists: ${key}`)
    this.map.set(key, t)
    t.link$(this.current$, undefined)
  }

  remove(item: Linked<T>): void {
    throw misuse("not implemented")
  }

  beginRenovation(): LinkedListRenovation<T> {
    if (this.former$ !== undefined)
      throw misuse("renovation is in progress already")
    const former = this.current$
    const target = this.current$ = new LinkedSubList$<T>()
    return new LinkedListRenovation$<T>(this, target, former)
  }

  endRenovation(r: LinkedListRenovation<T>, error?: unknown): void {
    const renovation = r as LinkedListRenovation$<T>
    renovation.done(error)
    this.former$ = undefined
  }

}

// Linked$

class Linked$<T> implements Linked<T> {

  private list$: LinkedSubList$<T> | undefined

  private next$: Linked$<T> | undefined

  private prev$: Linked$<T> | undefined

  value: T

  get list(): LinkedSubList$<T> | undefined { return this.list$ }

  get next(): Linked$<T> | undefined { return this.next$ }

  get prev(): Linked$<T> | undefined { return this.prev$ }

  index: number

  mark$: number

  constructor(value: T) {
    this.value = value
    this.list$ = undefined
    this.next$ = undefined
    this.prev$ = undefined
    this.index = -1
    this.mark$ = 0
  }

  get mark(): Mark {
    return this.mark$ % MARK_MOD
  }

  // const last = this.last
  // item.link$(this, last, undefined)
  // if (last !== undefined)
  //   this.last = last.next = item
  // else
  //   this.first = this.last = item
  // this.count++


  link$(list: LinkedSubList$<T> | undefined, before: Linked$<T> | undefined): void {
    if (before !== undefined) {
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
    else {
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

// LinkedSubList$

class LinkedSubList$<T> {

  count: number = 0

  first?: Linked$<T> = undefined

  last?: Linked$<T> = undefined;

  *items(): Generator<Linked$<T>> {
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

  grab(from: LinkedSubList$<T>, join: boolean): void {
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

// LinkedListRenovation$

export class LinkedListRenovation$<T> implements LinkedListRenovation<T> {

  list: AbstractLinkedList<T>

  private current$: LinkedSubList$<T>

  private added$: Array<Linked$<T>> | undefined

  private former$: LinkedSubList$<T>

  private expectedNext: Linked$<T> | undefined

  private lastUnknownKey: string | undefined

  constructor(list: LinkedList<T>, current: LinkedSubList$<T>, former: LinkedSubList$<T>) {
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
      item = this.lookup(key) as Linked$<T> | undefined
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
    const t = item as Linked$<T>
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
    const x = item as Linked$<T>
    x.mark$ = Mark.removed
  }

  move(item: Linked<T>, before: Linked<T> | undefined): void {
    throw misuse("not implemented")
  }

  setMark(item: Linked<T>, value: Mark): void {
    if (!this.list.isRenovationInProgress)
      throw misuse("item cannot be marked outside of renovation cycle")
    const x = item as Linked$<T>
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
  }

}
