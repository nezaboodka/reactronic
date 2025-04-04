﻿// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { MergeList, MergedItem } from "../source/util/MergeList.js"

test("merge-list", t => {
  const etalon1 = ["Hello", "Welcome", "Bye", "End"]
  const etalon2 = ["Added1", "Bye", "End", "Added2", "Hello", "Added3"]
  const etalon2a = ["Hello", "Bye", "End", "Added1", "Added2", "Added3"]

  // Basic
  const list = new MergeList<string>(s => s, true)
  for (const x of etalon1)
    list.mergeAsAdded(x)

  t.is(list.count, 4)
  t.is(list.addedCount, 4)
  t.is(list.removedCount, 0)
  t.true(compare(list.items(), etalon1))

  // Merge etalon2 with etalon1
  list.beginMerge()
  for (const x of etalon2)
    if (!list.tryMergeAsExisting(x))
      list.mergeAsAdded(x)
  list.endMerge()

  t.is(list.count, 6)
  t.true(list.lastMergedItem()?.index === 5)
  t.is(list.removedCount, 1)
  t.is(list.addedCount, 3)
  t.true(compare(list.items(), etalon2))
  t.true(compare(list.removedItems(), ["Welcome"]))
  t.true(compare(list.addedItems(), ["Added1", "Added2", "Added3"]))
  t.is(list.removedCount, 1)
  t.is(list.addedCount, 3)
  list.resetAddedAndRemovedLists()
  t.is(list.removedCount, 0)
  t.is(list.addedCount, 0)
  t.true(list.isAdded(list.lookup("Added1")!))
  t.true(list.isAdded(list.lookup("Added2")!))
  t.true(list.isAdded(list.lookup("Added3")!))
  t.true(list.isMoved(list.lookup("Bye")!))
  t.false(list.isMoved(list.lookup("End")!))
  t.true(list.isMoved(list.lookup("Hello")!))

  // Merge back, but with error
  list.beginMerge()
  for (const x of etalon1)
    if (!list.tryMergeAsExisting(x))
      list.mergeAsAdded(x)
  t.is(list.count, 4)
  t.true(list.lastMergedItem()?.index === 3)
  t.is(list.removedCount, 3)
  t.is(list.addedCount, 1)
  list.endMerge("error")
  t.is(list.count, 6)
  t.is(list.removedCount, 0)
  t.is(list.addedCount, 0)
  t.true(compare(list.items(), etalon2a))

  // Merge back again (success)
  list.beginMerge()
  for (const x of etalon1)
    if (!list.tryMergeAsExisting(x))
      list.mergeAsAdded(x)
  t.is(list.count, 4)
  t.is(list.removedCount, 3)
  t.is(list.addedCount, 1)
  list.endMerge()
  t.is(list.count, 4)
  t.is(list.removedCount, 3)
  t.is(list.addedCount, 1)
  t.true(compare(list.items(), etalon1))
})

function compare(list: Generator<MergedItem<unknown>>, array: Array<unknown>): boolean {
  let result = true
  let i = 0
  for (const item of list) {
    if (item.instance !== array[i]) {
      result = false
      break
    }
    i++
  }
  return result && i === array.length
}
