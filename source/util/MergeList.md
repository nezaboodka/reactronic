
# **MergeList**

MergeList provides fast merge algorithm for lists.
It efficiently detects differences/changes: which items
are added, moved, and removed.

``` typescript
const list = new MergeList<string>(s => s, true)

const example1 = ['Hello', 'Welcome', 'Bye', 'End']
for (const x of example1)
  list.add(x)

// list.items: Hello, Welcome, Bye, End

const example2 = ['Added1', 'Bye', 'End', 'Added2', 'Hello', 'Added3']
list.beginMerge()
for (const x of example2) {
  const existing = list.specify(x) // try to link with an existing item
  if (existing) {
    // merge x into existing (when item is an object)
  }
  else
    list.add(x, true) // otherwise add item as a new one
}
list.endMerge(true)

// list.items: Added1, Bye, End, Added2, Hello, Added3
// list.addedItems: Added1, Added2, Added3
// list.removedItems: Welcome
// list.isAdded: Added1, Added2, Added3
// list.isMoved: Bye, Hello
// list.isRemoved: Welcome
```

MergeList API:

``` typescript
interface MergeItem<T> {
  readonly instance: T
}

class MergeList<T> {
  readonly getKey: GetKey<T>
  readonly strict: boolean
  readonly count: number
  readonly addedCount: number
  readonly removedCount: number
  readonly isMergeInProgress: boolean

  lookup(key: string): MergeItem<T> | undefined
  specify(key: string): MergeItem<T> | undefined
  add(instance: T, keepInAddedItems?: boolean): MergeItem<T>
  remove(item: MergeItem<T>, keepInRemovedItems?: boolean): void
  move(item: MergeItem<T>, after: MergeItem<T>): void
  beginMerge(): void
  endMerge(clearAddedAndRemovedItems: boolean): void
  resetAddedAndRemovedLists(): void
  lastSpecifiedItem(): MergeItem<T> | undefined

  items(): Generator<MergeItem<T>>
  addedItems(keep?: boolean): Generator<MergeItem<T>>
  removedItems(keep?: boolean): Generator<MergeItem<T>>
  isAdded(item: MergeItem<T>): boolean
  isMoved(item: MergeItem<T>): boolean
  isRemoved(item: MergeItem<T>): boolean
  isCurrent(item: MergeItem<T>): boolean
}
```
