// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Collection, Item } from '../source/util/Collection'

test('collection', t => {
  const etalon1 = ['Hello', 'Welcome', 'Bye', 'End']
  const etalon2 = ['Added1', 'Bye', 'End', 'Added2', 'Hello', 'Added3']
  const etalon2a = ['Hello', 'Bye', 'End', 'Added1', 'Added2', 'Added3']

  // Basic
  const list = new Collection<string>(true, s => s)
  for (const x of etalon1)
    list.add(x)

  t.is(list.count, 4)
  t.is(list.addedCount, 4)
  t.is(list.removedCount, 0)
  t.true(compare(list.items(), etalon1))

  // Merge etalon2 with etalon1
  list.beginMerge()
  for (const x of etalon2)
    if (!list.claim(x))
      list.add(x)
  list.endMerge()

  t.is(list.count, 6)
  t.is(list.removedCount, 1)
  t.is(list.addedCount, 3)
  t.true(compare(list.items(), etalon2))
  t.true(compare(list.removedItems(), ['Welcome']))
  t.true(compare(list.addedItems(), ['Added1', 'Added2', 'Added3']))
  t.is(list.removedCount, 1)
  t.is(list.addedCount, 3)
  list.resetAddedAndRemovedLists()
  t.is(list.removedCount, 0)
  t.is(list.addedCount, 0)
  t.true(list.isAdded(list.lookup('Added1')!))
  t.true(list.isAdded(list.lookup('Added2')!))
  t.true(list.isAdded(list.lookup('Added3')!))
  t.true(list.isMoved(list.lookup('Bye')!))
  t.false(list.isMoved(list.lookup('End')!))
  t.true(list.isMoved(list.lookup('Hello')!))

  // Merge back, but with error
  list.beginMerge()
  for (const x of etalon1)
    if (!list.claim(x))
      list.add(x)
  t.is(list.count, 4)
  t.is(list.removedCount, 3)
  t.is(list.addedCount, 1)
  list.endMerge('error')
  t.is(list.count, 6)
  t.is(list.removedCount, 0)
  t.is(list.addedCount, 0)
  t.true(compare(list.items(), etalon2a))

  // Merge back again (success)
  list.beginMerge()
  for (const x of etalon1)
    if (!list.claim(x))
      list.add(x)
  t.is(list.count, 4)
  t.is(list.removedCount, 3)
  t.is(list.addedCount, 1)
  list.endMerge()
  t.is(list.count, 4)
  t.is(list.removedCount, 3)
  t.is(list.addedCount, 1)
  t.true(compare(list.items(), etalon1))
})

function compare(list: Generator<Item<string>>, array: Array<string>): boolean {
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
