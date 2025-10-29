
# **LinkedList**

LinkedList provides fast reconciliation (renovation)
algorithm for lists. It efficiently detects
differences/changes: which items are prolonged, added,
moved and removed.

``` typescript
const list = new LinkedList<LinkedValue>(s => s, true)

const example1 = ['Hello', 'Welcome', 'Bye', 'End']
const r1 = new LinkedListRenovation(list)
for (const x of example1)
  if (r1.tryToProlong(x) === undefined)
    r1.thisIsAdded(x)
r1.done()

// list.items: Hello, Welcome, Bye, End

const example2 = ['Added1', 'Bye', 'End', 'Added2', 'Hello', 'Added3']
const r2 = new LinkedListRenovation(list)
for (const x of example2) {
  const existing = r2.tryToProlong(x)
  if (existing) {
    // reuse prolonged item
  }
  else
    r2.thisIsAdded(x)
}
r2.done()

// list.items: Added1, Bye, End, Added2, Hello, Added3
// list.itemsAdded: Added1, Added2, Added3
// list.itemsRemoved: Welcome
// list.isAdded: Added1, Added2, Added3
// list.isMoved: Bye, Hello
// list.isRemoved: Welcome
```
