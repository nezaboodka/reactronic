// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { LinkedList, LinkedItem } from "../source/util/LinkedList.js"
import { LinkedListRenovation } from "../source/util/LinkedListRenovation.js"

class Property extends LinkedItem<Property> {
  value: string

  constructor(value: string) {
    super()
    this.value = value
  }
}

test("linked-list", t => {

  const list = new LinkedList<Property>(x => x.value, true)

  // Datasets

  const r1list = ["Hello", "Welcome", "Bye", "End"]

  const r2list = ["Added1", "Bye", "End", "Added2", "Hello", "Added3"]
  const r2result = ["Added1", "Bye", "End", "Manual", "Added2", "Hello", "Added3"]
  const r2lost = ["Welcome"]

  const r3list = ["Added1", "Bye", "Added2", "Hello", "Added3"]
  const r3result = ["Added1", "Bye", "Added2", "Hello", "Added3", "Manual"]
  const r3lost = ["End"]

  // Initial renovation

  const r = new LinkedListRenovation<Property>(list)
  for (const x of r1list) {
    r.add(new Property(x))
  }
  r.done()

  t.is(list.count, 4)
  t.is(r.lostItemCount, 0)
  t.true(compare(list.items(), r1list))

  // Manual item

  list.add(new Property("Manual"))
  t.is(list.count, 5)

  // Second renovation

  const r2 = new LinkedListRenovation<Property>(list)
  for (const x of r2list) {
    if (r2.tryProlong(x) === undefined)
      r2.add(new Property(x))
  }
  r2.done()

  t.is(list.count, r2result.length)
  t.is(r2.lostItemCount, r2lost.length)
  // t.is(list.countOfAdded, 0)
  // t.is(list.countOfRemoved, 0)
  t.true(compare(list.items(), r2result))
  t.true(compare(r2.lostItems(), r2lost))

  // Third renovation

  const r3 = new LinkedListRenovation<Property>(list)
  for (const x of r3list) {
    if (r3.tryProlong(x) === undefined)
      r3.add(new Property(x))
  }
  r3.done()

  t.is(list.count, r3result.length)
  t.is(r3.lostItemCount, r3lost.length)
  // t.is(list.countOfAdded, 0)
  // t.is(list.countOfRemoved, 0)
  t.true(compare(list.items(), r3result))
  t.true(compare(r3.lostItems(), r3lost))
})

function compare(list: Generator<Property>, array: Array<string>): boolean {
  let result = true
  let i = 0
  for (const item of list) {
    if (item.value !== array[i]) {
      result = false
      break
    }
    i++
  }
  return result && i === array.length
}
