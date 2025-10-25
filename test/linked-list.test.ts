// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { LinkedList, Linked } from "../source/util/LinkedList.js"
import { LinkedListRenovation } from "../source/util/LinkedListRenovation.js"

test("linked-list", t => {

  const list = new LinkedList<string>(x => x.value, true)

  // Etalon

  const etalon1 = ["Hello", "Welcome", "Bye", "End"]
  const etalon2 = ["Added1", "Bye", "End", "Added2", "Hello", "Added3"]
  const etalon2c = ["Added1", "Bye", "End", "Manual", "Added2", "Hello", "Added3"]
  const etalon2u = ["Welcome"]
  // const etalon2a = ["Hello", "Bye", "End", "Added1", "Added2", "Added3"]

  // Initial renovation

  const r = new LinkedListRenovation<string>(list)
  for (const x of etalon1) {
    r.add(new Linked<string>(x))
  }
  r.done()

  t.is(list.count, 4)
  t.is(r.lostCount, 0)
  t.true(compare(list.items(), etalon1))

  // Manual item

  list.add(new Linked<string>("Manual"))
  t.is(list.count, 5)

  // Second renovation

  const r2 = new LinkedListRenovation<string>(list)
  for (const x of etalon2) {
    if (r2.tryReuse(x) === undefined)
      r2.add(new Linked<string>(x))
  }
  r2.done()

  t.is(list.count, etalon2c.length)
  t.is(r2.lostCount, etalon2u.length)
  // t.is(list.countOfAdded, 0)
  // t.is(list.countOfRemoved, 0)
  t.true(compare(list.items(), etalon2c))
  t.true(compare(r2.lost(), etalon2u))

})

function compare(list: Generator<Linked<unknown>>, array: Array<unknown>): boolean {
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
