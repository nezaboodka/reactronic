
# **ReconciliationList**

ReconciliationList provides fast reconciliation algorithm for
lists. It efficiently detects differences/changes: which
items are added, moved, and removed.

``` typescript
const list = new ReconciliationList<string>(s => s, true)

const example1 = ['Hello', 'Welcome', 'Bye', 'End']
for (const x of example1)
  list.add(x)

// list.items: Hello, Welcome, Bye, End

const example2 = ['Added1', 'Bye', 'End', 'Added2', 'Hello', 'Added3']
list.beginScriptExecution()
for (const x of example2) {
  const existing = list.tryReuse(x)
  if (existing) {
    // reuse existing item
  }
  else
    list.add(x, true)
}
list.endScriptExecution(true)

// list.items: Added1, Bye, End, Added2, Hello, Added3
// list.itemsAdded: Added1, Added2, Added3
// list.itemsRemoved: Welcome
// list.isAdded: Added1, Added2, Added3
// list.isMoved: Bye, Hello
// list.isRemoved: Welcome
```

ReconciliationList API:

``` typescript
type LinkedItem<T> = {
  readonly instance: T
}

class ReconciliationList<T> {
  readonly getKey: GetKey<T>
  readonly strict: boolean
  readonly count: number
  readonly countOfAdded: number
  readonly countOfRemoved: number
  readonly isScriptExecutionInProgress: boolean

  lookup(key: string): LinkedItem<T> | undefined
  tryReuse(key: string): LinkedItem<T> | undefined
  add(instance: T, keepInAddedItems?: boolean): LinkedItem<T>
  remove(item: LinkedItem<T>, keepInRemovedItems?: boolean): void
  move(item: LinkedItem<T>, after: LinkedItem<T>): void
  beginScriptExecution(): void
  endScriptExecution(clearAddedAndRemovedItems: boolean): void
  resetAddedAndRemovedLists(): void
  first(): LinkedItem<T> | undefined
  last(): LinkedItem<T> | undefined

  items(): Generator<LinkedItem<T>>
  itemsAdded(keep?: boolean): Generator<LinkedItem<T>>
  itemsRemoved(keep?: boolean): Generator<LinkedItem<T>>
  isAdded(item: LinkedItem<T>): boolean
  isMoved(item: LinkedItem<T>): boolean
  isRemoved(item: LinkedItem<T>): boolean
  isAlive(item: LinkedItem<T>): boolean
}
```
