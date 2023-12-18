
# **MergeList**

MergeList provides fast merge algorithm for lists.
It efficiently detects differences/changes: which items
are added, moved, and removed.

``` typescript
const list = new MergeList<string>(s => s, true)

const example1 = ['Hello', 'Welcome', 'Bye', 'End']
for (const x of example1)
  list.mergeAsAdded(x)

// list.items: Hello, Welcome, Bye, End

const example2 = ['Added1', 'Bye', 'End', 'Added2', 'Hello', 'Added3']
list.beginMerge()
for (const x of example2) {
  const existing = list.tryMergeAsExisting(x)
  if (existing) {
    // merge x into existing (when item is an object)
  }
  else
    list.mergeAsAdded(x, true)
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
type MergedItem<T> = {
  readonly instance: T
}

class MergeList<T> {
  readonly getKey: GetKey<T>
  readonly strict: boolean
  readonly count: number
  readonly addedCount: number
  readonly removedCount: number
  readonly isMergeInProgress: boolean

  lookup(key: string): MergedItem<T> | undefined
  tryMergeAsExisting(key: string): MergedItem<T> | undefined
  mergeAsAdded(instance: T, keepInAddedItems?: boolean): MergedItem<T>
  mergeAsRemoved(item: MergedItem<T>, keepInRemovedItems?: boolean): void
  move(item: MergedItem<T>, after: MergedItem<T>): void
  beginMerge(): void
  endMerge(clearAddedAndRemovedItems: boolean): void
  resetAddedAndRemovedLists(): void
  lastMergedItem(): MergedItem<T> | undefined

  items(): Generator<MergedItem<T>>
  addedItems(keep?: boolean): Generator<MergedItem<T>>
  removedItems(keep?: boolean): Generator<MergedItem<T>>
  isAdded(item: MergedItem<T>): boolean
  isMoved(item: MergedItem<T>): boolean
  isRemoved(item: MergedItem<T>): boolean
  isActual(item: MergedItem<T>): boolean
}
```
