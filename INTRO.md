

# Introduction to Transactionally Reactive Programming in TypeScript

Key concept of the transactionally reactive programming is reaction.
Reaction is an operation that is executed automatically, when
an another operation changes data, which the reaction depends on.

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
    if (!email.contains('@'))
      throw new Error(`wrong email ${email}`)
    Console.log(name + ' <' + email + '>')
  }
}
```

In the example above, the operation `saveContact` triggers
automatic execution of the reaction `printContact`, which
depends on `name` and `email` fields changed by the operation.

If reaction needs to use data without tracking their changes
(thus not reacting on them), `nonreactive` function can
be used:

``` typescript
@reaction
printContact() {
  const name = nonreactive(() => this.name)
  Console.log(name + ' <' + this.email + '>')
}
```

In the example above the reaction `printContact` is executed
only in case of `email` field change, but not `name` field that
is used through `nonreactive`.

It is possible to define cached computations:

``` typescript
class Demo extends ObservableObject {
  name: string = 'Nezaboodka Software'
  email: string = 'contact@nezaboodka.com'

  @cached
  get contact: string { // result is cached
    return this.name + ' <' + this.email + '>'
  }

  @reaction
  printContact() {
    if (!this.contact === '')
      Console.log(this.contact)
  }
```

In the example above, the result of `contact` is computed from
source fields `name` and `email`. Once computed, the result is
cached and is reused until source fields `name` and `email` are
changed. Once source fields changed, the computed result
`contact` becomes invalidated, thus causing execution of
depending reaction `printContact`. Then `printContact` during
its execution causes `contact` recomputation on the first use.
