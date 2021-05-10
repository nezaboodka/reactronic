

# Introduction to transactionally reactive programming with TypeScript

Key concept of the transactionally reactive programming is reaction.
Reaction is an operation that is executed automatically, when
an another operation changes data, which the reaction depends on.

``` typescript
class Demo extends ObservableObject {
  name: 'Nezaboodka Software'
  email: 'contact@nezaboodka.com'

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
(thus not reacting on them), `nonreactiveRun` function can
be used:

``` typescript
@reaction
printContact() {
  const name = nonreactiveRun(() => this.name)
  Console.log(name + ' <' + this.email + '>')
}
```

In the example above the reaction `printContact` is executed
only in case of `email` field change, but not `name` field that
is used through `nonreactiveRun`.

[To be continued]
