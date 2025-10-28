// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { TestsLoggingLevel } from "./brief.js"
import { ReactiveSystem } from "../source/api.js"
import { LinkedList, LinkedItem, Mark } from "../source/util/LinkedList.js"
import { LinkedListRenovation } from "../source/util/LinkedListRenovation.js"

class Property extends LinkedItem<Property> {
  value: string

  constructor(value: string) {
    super()
    this.value = value
  }
}

test("linked-list", t => {

  ReactiveSystem.setLoggingMode(true, TestsLoggingLevel)

  const list = new LinkedList<Property>(x => x.value, true)

  // Datasets

  const r1list = ["A", "B", "C", "D"]

  const m1result = ["A", "B", "C", "m1", "D", "m2"]

  const r2list = ["X", "C", "D", "Y", "A", "Z"]
  const r2result = ["X", "C", "m1", "D", "Y", "A", "Z", "m2"]
  const r2lost = ["B"]

  const r3list = ["X", "C", "Y", "A", "Z"]
  const r3result = ["X", "C", "Y", "A", "Z", "m1", "m2"]
  const r3lost = ["D"]

  const m2result = ["X", "C", "Y", "A", "Z"]

  // Initial renovation

  const r = new LinkedListRenovation<Property>(list)
  for (const x of r1list) {
    r.thisIsAdded(new Property(x))
  }
  r.done()

  t.is(list.count, 4)
  t.is(r.lostItemCount, 0)
  t.true(compare(list.items(), r1list))

  // Manual manipulations

  list.add(new Property("m1"), list.lookup("D"))
  list.add(new Property("m2"))
  t.is(list.count, m1result.length)
  t.true(compare(list.items(), m1result))

  // Second renovation

  const r2 = new LinkedListRenovation<Property>(list)
  for (const x of r2list) {
    if (r2.thisIsProlonged(x) === undefined)
      r2.thisIsAdded(new Property(x))
  }
  r2.done()

  t.is(list.count, r2result.length)
  t.is(r2.lostItemCount, r2lost.length)
  // t.is(list.countOfAdded, 0)
  // t.is(list.countOfRemoved, 0)
  t.true(compare(list.items(), r2result))
  t.true(compare(r2.lostItems(), r2lost))
  t.is(list.lookup("A")?.mark, Mark.modified)

  // Third renovation

  const r3 = new LinkedListRenovation<Property>(list)
  for (const x of r3list) {
    if (r3.thisIsProlonged(x) === undefined)
      r3.thisIsAdded(new Property(x))
  }
  r3.done()

  t.is(list.count, r3result.length)
  t.is(r3.lostItemCount, r3lost.length)
  // t.is(list.countOfAdded, 0)
  // t.is(list.countOfRemoved, 0)
  t.true(compare(list.items(), r3result))
  t.true(compare(r3.lostItems(), r3lost))

  // Manual manipulations

  t.throws(() => list.remove(list.lookup("X")!), { message: "manual item cannot be removed outside of renovation cycle" })
  list.remove(list.lookup("m1")!)
  list.remove(list.lookup("m2")!)
  t.is(list.count, m2result.length)
  t.true(compare(list.items(), m2result))
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
