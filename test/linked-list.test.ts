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

const P = Mark.prolonged
const A = Mark.added
const M = Mark.modified
const R = Mark.removed

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

  // Initial renovation

  const r1list = ["A", "B", "C", "D"]
  const r1marks = [A, A, A, A]

  const r = new LinkedListRenovation<Property>(list)
  for (const x of r1list) {
    r.thisIsAdded(new Property(x))
  }
  r.done()

  t.is(list.count, 4)
  t.true(compareValues(list.items(), r1list))
  t.true(compareValues(list.items(), r1list))
  t.true(compareMarks(marks(list.items()), r1marks))
  t.is(r.lostItemCount, 0)

  // External items

  const m1result = ["A", "B", "C", "m1", "D", "m2"]
  const m1marks = [A, A, A, P, A, P]

  list.add(new Property("m1"), list.lookup("D"))
  list.add(new Property("m2"))
  t.is(list.count, m1result.length)
  t.true(compareValues(list.items(), m1result))
  t.true(compareMarks(marks(list.items()), m1marks))
  t.is(r.lostItemCount, 0)

  // Second renovation

  const r2list = ["X", "C", "D", "Y", "A", "Z"]
  const r2result = ["X", "C", "m1", "D", "Y", "A", "Z", "m2"]
  const r2marks = [A, M, P, P, A, M, A, P]
  const r2lost = ["B"]

  const r2 = new LinkedListRenovation<Property>(list)
  for (const x of r2list) {
    if (r2.tryToProlonge(x) === undefined)
      r2.thisIsAdded(new Property(x))
  }
  r2.done()

  t.is(list.count, r2result.length)
  t.true(compareValues(list.items(), r2result))
  t.true(compareMarks(marks(list.items()), r2marks))
  t.true(compareValues(r2.lostItems(), r2lost))
  t.true([...r2.lostItems()].every(x => x.mark === R))

  // Third renovation

  const r3list = ["X", "C", "Y", "A", "Z"]
  const r3result = ["X", "C", "Y", "A", "Z", "m1", "m2"]
  const r3marks = [P, P, M, P, P, P, P]
  const r3lost = ["D"]

  const r3 = new LinkedListRenovation<Property>(list)
  for (const x of r3list) {
    if (r3.tryToProlonge(x) === undefined)
      r3.thisIsAdded(new Property(x))
  }
  r3.done()

  t.is(list.count, r3result.length)
  t.true(compareValues(list.items(), r3result))
  t.true(compareMarks(marks(list.items()), r3marks))
  t.true(compareValues(r3.lostItems(), r3lost))
  t.true([...r3.lostItems()].every(x => x.mark === R))

  // External items

  const m2result = ["X", "C", "Y", "A", "Z"]
  const m2marks = [P, P, M, P, P]

  t.throws(() => list.remove(list.lookup("X")!), {
    message: "external item cannot be removed outside of renovation cycle" })
  list.remove(list.lookup("m1")!)
  list.remove(list.lookup("m2")!)
  t.is(list.count, m2result.length)
  t.true(compareValues(list.items(), m2result))
  t.true(compareMarks(marks(list.items()), m2marks))
  t.is(r.lostItemCount, 0)
})

function compareValues(list: Generator<Property>, array: Array<string>): boolean {
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

function compareMarks(marks: Generator<Mark>, array: Array<Mark>): boolean {
  let result = true
  let i = 0
  for (const m of marks) {
    if (m !== array[i]) {
      result = false
      break
    }
    i++
  }
  return result && i === array.length
}

function *marks(list: Generator<Property>): Generator<Mark> {
  for (const x of list)
    yield x.mark
}
