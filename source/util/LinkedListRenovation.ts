// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"
import { LinkedList, Linked, LinkedSubList, Mark } from "./LinkedList.js"

// LinkedListRenovation<T>

export class LinkedListRenovation<T> {

  readonly list: LinkedList<T>

  private lost$: LinkedSubList<T>

  private changes$: Array<Linked<T>>

  private expectedNext: Linked<T> | undefined

  private lastUnknownKey: string | undefined

  constructor(list: LinkedList<T>) {
    if (list.former$ !== undefined)
      throw misuse("renovation is in progress already")
    const current = new LinkedSubList<T>()
    const lost = list.current$
    this.list = list
    list.current$ = current
    list.former$ = lost
    this.lost$ = lost
    this.changes$ = []
    this.expectedNext = reuseManualSiblings(lost.first, current)
    this.lastUnknownKey = undefined
  }

  lookup(key: string | undefined): Linked<T> | undefined {
    let result: Linked<T> | undefined = undefined
    if (key !== undefined && key !== this.lastUnknownKey) {
      result = this.list.lookup(key)
      if (result !== undefined) {
        if (this.list.extractKey(result) !== key) {
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
      throw misuse(error ?? "renovation is no longer in progress")
    let item = this.expectedNext
    if (key !== (item ? list.extractKey(item) : undefined))
      item = this.lookup(key)
    if (item !== undefined) {
      const current = this.list.current$
      if (item.list !== current) {
        const next = item.next // remember before re-linking
        Linked.link$(item, current, undefined)
        if (list.isStrictOrder && item !== this.expectedNext)
          Linked.setStatus$(item, Mark.moved, current.count)
        else
          Linked.setStatus$(item, Mark.same, current.count)
        this.expectedNext = reuseManualSiblings(next, current)
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
    this.list.add(item)
    Linked.setStatus$(item, Mark.added, this.list.current$.count)
    this.lastUnknownKey = undefined
    this.expectedNext = undefined
    this.changes$.push(item)
    return item
  }

  remove(item: Linked<T>): void {
    this.list.remove(item)
    Linked.setStatus$(item, Mark.removed, 0)
  }

  move(item: Linked<T>, before: Linked<T> | undefined): void {
    this.list.move(item, before)
    Linked.setStatus$(item, Mark.moved, 0)
  }

  // get addedCount(): number {
  //   return this.changes$?.length ?? 0
  // }

  // *added(): Generator<Linked<T>> {
  //   const added = this.changes$
  //   if (added !== undefined)
  //     for (const x of added)
  //       yield x
  // }

  get lostCount(): number {
    return this.lost$.count
  }

  lost(): Generator<Linked<T>> {
    return this.lost$.items()
  }

  done(error?: unknown): void {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse("renovation is ended already")
    const lost = this.lost$
    if (error === undefined) {
      for (const x of lost.items()) {
        LinkedList.deleteKey$(list, x)
        Linked.setStatus$(x, Mark.lost, 0)
      }
    }
    else {
      const current = this.list.current$
      for (const x of lost.items()) {
        Linked.link$(x, current, undefined)
        Linked.setStatus$(x, Mark.same, current.count)
      }
    }
    list.former$ = undefined
  }

}

function reuseManualSiblings<T>(
  item: Linked<T> | undefined,
  current: LinkedSubList<T>): Linked<T> | undefined {
  while (item !== undefined && item.isManual) {
    Linked.link$(item, current, undefined)
    item = item.next
  }
  return item
}
