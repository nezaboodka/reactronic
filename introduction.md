

# Introduction to Transactionally Reactive Programming in TypeScript

Key concepts of transactionally reactive programming are:

  - **Observable Objects** - a set of objects that store data
    of an application (state);
  - **Operation** - a code block that makes changes in observable
    objects in transactional (atomic) way;
  - **Reaction** - an operation that is called automatically in
    response to changes made by another operation;
  - **Cache** - a computed value having associated code block that is
    called on-demand to renew the value if it was marked as obsolete.

Here is an example of operation and reaction:

``` typescript
class Demo extends ObservableObject {
  name: string = 'Nezaboodka Software'
  email: string = 'contact@nezaboodka.com'

  @operation
  saveContact(name: string, email: string) {
    this.name = name
    this.email = email
  }

  @reaction
  printContact() {
    // depends on `name` and `email` and reacts to their changes
    if (!this.email.contains('@'))
      throw new Error(`wrong email ${this.email}`)
    Console.log(this.name + ' <' + this.email + '>')
  }
}
```

In the example above, `printContact` reaction depends on `name`
and `email` fields. The reaction is executed automatically in
response to changes of these fields made by `saveContact`
operation.

If reaction needs to use some data without tracking their changes,
thus not reacting on them, `nonreactive` function can be used:

``` typescript
@reaction
printContact() {
  const name = nonreactive(() => this.name)
  Console.log(name + ' <' + this.email + '>')
}
```

In the example above, `printContact` reaction is executed
only in case of `email` field change, but not `name` field
change.

Here is an example of on-demand cached computation:

``` typescript
class Demo extends ObservableObject {
  name: string = 'Nezaboodka Software'
  email: string = 'contact@nezaboodka.com'

  @cached
  get contact(): string {
    return this.name + ' <' + this.email + '>'
  }

  @reaction
  printContact() {
    if (this.contact !== '')
      Console.log(this.contact)
  }
```

In the example above, the value of `contact` is computed from
source fields `name` and `email`. Once computed, the result is
cached and is reused until source fields `name` and `email` are
changed. Once source fields changed, `contact` value becomes
invalidated, thus causing execution of depending reaction
`printContact`. Then `printContact` reaction causes `contact`
re-computation on the first use.

## The order and mechanism of reactions execution

Dependencies between data and reactions are detected dynamically
at run time as a result of accessing data during execution of
reactions, but not as a result of static analysis during code
compilation. In order to start tracking data for the first time
each reaction is executed automatically and unconditionally
right after completion of an operation that creates an object,
which reaction is defined in. All subsequent executions of
reaction happens only upon changes of data, which reaction
depends on.

Reaction is executed at the end of an operation that makes
changes in data, and only in case of new values are truly
different from old ones. In case of exception inside an
operation, depending reactions are not executed and all
the changes made by the operation are discarded.

Reaction depends only on data, which it reads, but never
depends on data, which it changes. Moreover, if reaction
reads some data and then changes it, then dependency is
discarded and reaction doesn't react on its change.

## Mechanism of transactional execution of operations and reactions

Operations and reactions are executed in transactional way
with full respect to principles of atomicity, consistency,
and isolation. It means that an operation and depending
reactions work with logical data snapshot, where all the
changes are made.

To be continued...
