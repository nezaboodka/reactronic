

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
