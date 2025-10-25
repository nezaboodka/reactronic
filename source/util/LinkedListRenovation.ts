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

  private confirmed$: LinkedSubList<T>

  private unconfirmed$: LinkedSubList<T>

  private added$: Array<Linked<T>> | undefined

  private expectedNext: Linked<T> | undefined

  private lastUnknownKey: string | undefined

  constructor(list: LinkedList<T>) {
    if (list.former$ !== undefined)
      throw misuse("renovation is in progress already")
    const confirmed = new LinkedSubList<T>()
    const unconfirmed = list.current$
    this.list = list
    list.current$ = confirmed
    this.confirmed$ = confirmed
    list.former$ = unconfirmed
    this.unconfirmed$ = unconfirmed
    this.added$ = undefined
    this.expectedNext = reuseManualItemsIfAny(unconfirmed.first, confirmed)
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
      throw misuse(error ?? "renovation is not in progress")
    let item = this.expectedNext
    if (key !== (item ? list.extractKey(item) : undefined))
      item = this.lookup(key)
    if (item !== undefined) {
      const confirmed = this.confirmed$
      if (item.list !== confirmed) {
        const next = item.next // remember before re-linking
        Linked.link$(item, confirmed, undefined)
        if (list.isStrictOrder && item !== this.expectedNext)
          Linked.setStatus$(item, Mark.moved, confirmed.count)
        else
          Linked.setStatus$(item, Mark.existing, confirmed.count)
        this.expectedNext = reuseManualItemsIfAny(next, confirmed)
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
    Linked.setStatus$(item, Mark.added, this.confirmed$.count)
    this.lastUnknownKey = undefined
    this.expectedNext = undefined
    let added = this.added$
    if (added == undefined)
      added = this.added$ = []
    added.push(item)
    return item
  }

  remove(item: Linked<T>): void {
    this.list.remove(item)
    Linked.setStatus$(item, Mark.removed, 0)
  }

  move(item: Linked<T>, before: Linked<T> | undefined): void {
    throw misuse("not implemented")
  }

  get confirmedCount(): number {
    return this.confirmed$.count
  }

  confirmed(): Generator<Linked<T>> {
    return this.confirmed$.items()
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

  get unconfirmedCount(): number {
    return this.unconfirmed$.count
  }

  unconfirmed(): Generator<Linked<T>> {
    return this.unconfirmed$.items()
  }

  done(error?: unknown): void {
    const list = this.list
    if (!list.isRenovationInProgress)
      throw misuse("renovation is ended already")
    const unconfirmed = this.unconfirmed$
    if (error === undefined) {
      for (const x of unconfirmed.items()) {
        LinkedList.deleteKey$(list, x)
        Linked.setStatus$(x, Mark.removed, 0)
      }
    }
    else {
      const confirmed = this.confirmed$
      for (const x of unconfirmed.items()) {
        Linked.link$(x, confirmed, undefined)
        Linked.setStatus$(x, Mark.existing, confirmed.count)
      }
    }
    list.former$ = undefined
  }

}

function reuseManualItemsIfAny<T>(
  item: Linked<T> | undefined,
  confirmed: LinkedSubList<T>): Linked<T> | undefined {
  while (item !== undefined && item.isManual) {
    Linked.link$(item, confirmed, undefined)
    item = item.next
  }
  return item
}
