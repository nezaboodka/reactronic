
# **LinkedList**

LinkedList provides fast reconciliation (renovation)
algorithm for lists. It efficiently detects
differences/changes: which items are reaffirmed, added,
moved and removed.

``` typescript
const list = new LinkedList<LinkedValue>(s => s, true)

const example1 = ['Hello', 'Welcome', 'Bye', 'End']
const r1 = new LinkedListRenovation(list)
for (const x of example1)
  if (r1.tryReaffirm(x) === undefined)
    r1.thisIsAdded(x)
r1.done()

// list.items: Hello, Welcome, Bye, End

const example2 = ['Added1', 'Bye', 'End', 'Added2', 'Hello', 'Added3']
const r2 = new LinkedListRenovation(list)
for (const x of example2) {
  const existing = r2.tryReaffirm(x)
  if (existing) {
    // reuse reaffirmed item
  }
  else
    r2.thisIsAdded(x)
}
r2.done()

// list.items: Added1, Bye, End, Added2, Hello, Added3
```

(WIP)
