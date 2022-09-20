
[![Readiness](https://img.shields.io/badge/release-beta-red.svg)](https://en.wikipedia.org/wiki/Software_release_life_cycle#Release_candidate)
[![GitHub License](https://img.shields.io/badge/license-Apache2-4cc61e.svg?style=flat)](https://github.com/nezaboodka/reactronic/blob/master/LICENSE)
[![NPM Version](https://img.shields.io/npm/v/reactronic.svg?style=flat&colorB=success)](https://www.npmjs.com/package/reactronic)
[![Package Size](https://img.shields.io/bundlephobia/minzip/reactronic.svg?colorB=success)](https://bundlephobia.com/result?p=reactronic)
![Coverage](https://img.shields.io/badge/coverage-97%25-success.svg)
![Lines](https://img.shields.io/badge/lines-2722-success.svg)
[![Demo](https://img.shields.io/badge/demo-live-success.svg)](https://gitlab.com/nezaboodka/nevod.website/-/blob/master/README.md)

# **Reactronic** - Transactional Reactive State Management

Reactronic is an experimental JavaScript library that provides
[transactional reactive](https://blog.nezaboodka.com/post/2019/593-modern-database-should-natively-support-transactionally-reactive-programming)
state management in a Web application.

Transactional reactivity means that state changes are being made in an
isolated data snapshot and then, once atomically applied, are
**consistently propagated** to corresponding visual components for
(re)rendering. All that is done in automatic, seamless, and fine-grained
way, because reactronic **takes full care of tracking dependencies**
between visual components (observers) and state (observable objects).

Transactional reactivity is based on four fundamental concepts:

  - **Observable Objects** - a set of objects that store data of an
    application (state);
  - **Transactional Function** - makes changes in observable
    objects in atomic way ("all or nothing");
  - **Reactive Function** - is executed automatically in
    response to changes made by a transaction;
  - **Cached Function** - its result is remembered and, if the becomes
  obsolete, recomputed on-demand.

Demo application built with Reactronic: https://nevod.io/#/playground.
Source code of the demo: https://gitlab.com/nezaboodka/nevod.web.public/-/blob/master/README.md.

Quick introduction and detailed description is below.

## Quick Introduction

Here is an example of transactional reactive code:

``` typescript
class Demo extends ObservableObject {
  name: string = 'Nezaboodka Software'
  email: string = 'contact@nezaboodka.com'

  @transactional
  saveContact(name: string, email: string): void {
    this.name = name
    this.email = email
  }

  @reactive
  printContact(): void {
    // depends on `name` and `email` and reacts to their changes
    if (this.email.indexOf('@') >= 0)
      throw new Error(`wrong email ${this.email}`)
    console.log(this.name + ' <' + this.email + '>')
  }
}
```

In the example above, `printContact` function depends on `name`
and `email` fields. It is executed automatically in response
to changes of these fields made by `saveContact` function.

Here is an example of cached value (re-)computed on-demand:

``` typescript
class Demo extends ObservableObject {
  name: string = 'Nezaboodka Software'
  email: string = 'contact@nezaboodka.com'

  @cached
  get contact(): string {
    return this.name + ' <' + this.email + '>'
  }

  @reactive
  printContact(): void {
    if (this.contact !== '')
      Console.log(this.contact)
  }
}
```

In the example above, the value of `contact` is computed from
source fields `name` and `email` upon first use. Once computed,
the result is cached and is reused until source fields `name`
and `email` are changed. Once source fields changed, `contact`
value becomes obsolete, thus causing execution of depending
reactive function `printContact`. When `printContact` function
runs it reads `contact` and causes its re-computation.

## Observable Objects

Observable objects store data of an application. All such objects
are transparently hooked to track access to their properties,
both on reads and writes.

``` typescript
class MyModel extends ObservableObject {
  url: string = "https://github.com/nezaboodka/reactronic"
  content: string = "transactional reactive state management"
  timestamp: Date = Date.now()
}
```

In the example above, the class `MyModel` is based on Reactronic's
`ObservableObject` class and all its properties `url`, `content`,
and `timestamp` are hooked.

## Transactional Functions

Transactional function makes changes in observable objects
in transactional (atomic) way. Such a function is instrumented
with hooks to provide transparent atomicity (by implicit context
switching and isolation).

``` typescript
class MyModel extends ObservableObject {
  // ...
  @transactional
  async load(url: string): Promise<void> {
    this.url = url
    this.content = await fetch(url)
    this.timestamp = Date.now()
  }
}
```

In the example above, the transactional function `load` makes
changes to `url`, `content` and `timestamp` properties. While
transaction is running, the changes are visible only inside the
transaction itself. The new values become atomically visible outside
of the transaction only upon its completion.

Atomicity is achieved by making changes in an isolated data
snapshot that is not visible outside of the running transaction
until it is fully finished and applied. Multiple objects
and their properties can be changed with full respect
to the all-or-nothing principle. To do so, separate data
snapshot is automatically maintained for each transaction.
That is a logical snapshot that does not create a full copy
of all the data.

Compensating rollback operations are not needed in case of the
transaction failure, because all the changes made by the transaction
in its logical snapshot are simply discarded. In case the transaction
is successfully applied, affected caches are marked as obsolete
and corresponding caching functions are re-executed in a proper
order (but only when all the data changes are fully applied).

Asynchronous operations (promises) are supported out of the box
during transaction execution. The transaction may consist of a set of
asynchronous calls prolonging the transaction until completion of
all of them. An asynchronous call may spawn other asynchronous
calls, which prolong transaction execution until the whole chain
of asynchronous operations is fully completed.

## Reactive & Cached Functions

Reactive function is automatically and immediately called in
response to changes made by a transaction in observable objects.
Cached function is called on-demand to renew the value if it was
marked as obsolete due to changes made by a transaction.
Reactive and cached functions are instrumented with hooks
to seamlessly subscribe to those observable objects and
other cached functions (dependencies), which are used
during their execution.

``` tsx
class MyView extends Component<{model: MyModel}> {
  @cached
  render(): JSX.Element {
    return (
      <div>
        <h1>{this.props.model.url}</h1>
        <div>{this.props.model.content}</div>
      </div>
    )
  } // render is subscribed to "url" and "content"
}
```

``` tsx
class Component<P> extends React.Component<P> {
  @cached
  render(): JSX.Element {
    throw new Error('render method is undefined')
  }

  @reactive // called immediately in response to changes
  ensureUpToDate(): void {
    if (this.shouldComponentUpdate())
      Transaction.outside(() => this.setState({})) // ask React to re-render
  } // ensureUpToDate is subscribed to render

  shouldComponentUpdate(): boolean {
    return !Rx.getController(this.render).isUpToDate
  }

  componentDidMount(): void {
    this.ensureUpToDate() // run to subscribe for the first time
  }

  componentWillUnmount(): void {
    Transaction.run(null, Rx.dispose, this)
  }
}
```

In the example above, reactive function `refresh` is transparently subscribed
to the cached function `render`. In turn, the `render` function is
subscribed to the `url` and `content` properties of a corresponding
`MyModel` object. Once `url` or `content` values are changed, the
`render` cache becomes obsolete and causes the `refresh` function to become
obsolete as well and re-executed. While being executed, the `refresh`
function enqueues re-rendering request to React, which calls
`render` function causing it to renew its cached value.

In general case, all reactive and cached functions are automatically and
immediately marked as obsolete when changes are made in those observable
objects and other cached functions that were used during their execution.
And once marked, the functions are automatically executed again,
either immediately (for @reactive functions) or on-demand
(for @cached functions).

Reactronic takes full care of tracking dependencies between
all the observable objects and reactive/cached functions.
With Reactronic, you no longer need to create data change events
in one set of objects, subscribe to these events in other objects,
and manually maintain switching from the previous object version
to a new one.

## Behavior Options

There are multiple options to configure behavior of transactional reactivity.

**Order** options defines order of execution for reactive functions:

  - (TBD)

**Throttling** option defines how often reactive function is executed in case
of recurring changes:

  - `(ms)` - minimal delay in milliseconds between executions;
  - `-1` - execute immediately once transaction is applied (synchronously);
  - `0` - execute immediately via event loop (asynchronously with zero timeout);
  - `>= Number.MAX_SAFE_INTEGER` - never execute (suspended reactive function).

**Reentrance** option defines how to handle reentrant calls of transactional
and reactive functions:

  - `PreventWithError` - fail with error if there is an existing call in progress;
  - `WaitAndRestart` - wait for previous call to finish and then restart current one;
  - `CancelPrevious` - cancel previous call in favor of recent one;
  - `CancelAndWaitPrevious` - cancel previous call in favor of recent one (but wait until canceling is completed)
  - `RunSideBySide` - multiple simultaneous calls are allowed.

**Monitor** is an object that maintains status of running functions,
which it is attached to. A single monitor object can be shared between
multiple transactional, reactive, and cached functions, thus maintaining
consolidated status for all of them (busy, workers, etc).

## Notes

Inspired by: MobX, Nezaboodka, Excel.

Key Reactronic principles and differentiators:

  - No compromises on consistency, clarity, and simplicity;
  - Minimalism and zero boilerplating (it's not a framework bloating your code);
  - Asynchrony, patches, undo/redo, conflict resolving are provided out of the box;
  - Seamless integration with transactional reactive object-oriented databases like [Nezaboodka](https://nezaboodka.com/#products);
  - Compact dependency-free implementation consisting of less than 2K lines of code.

Roadmap:

  - Patches and conflict resolution API (partially done)
  - History/undo/redo API and implementation (partially done)
  - Sync API and implementation (not implemented yet)

## Installation

NPM: `npm install reactronic`

## API (TypeScript)

```typescript

// Classes

class TransactionalObject { }
class ObservableObject { }

// Decorators & Operators

function raw(proto, prop) // field only
function transaction(proto, prop, pd) // method only
function reactive(proto, prop, pd) // method only
function cached(proto, prop, pd) // method only
function options(value: Partial<MemberOptions>): F<any>

function nonreactive<T>(func: F<T>, ...args: any[]): T
function sensitive<T>(sensitivity: Sensitivity, func: F<T>, ...args: any[]): T

// SnapshotOptions, MemberOptions, Kind, Reentrance, Monitor, LoggingOptions, ProfilingOptions

export interface SnapshotOptions {
  readonly hint?: string
  readonly separation?: SeparationMode
  readonly journal?: Journal
  readonly logging?: Partial<LoggingOptions>
  readonly token?: any
}

interface MemberOptions {
  readonly kind: Kind
  readonly separation: SeparationMode
  readonly order: number
  readonly noSideEffects: boolean
  readonly triggeringArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately, Number.MAX_SAFE_INTEGER is never
  readonly reentrance: Reentrance
  readonly journal: Journal | undefined
  readonly monitor: Monitor | null
  readonly logging?: Partial<LoggingOptions>
}

enum Kind {
  Plain = 0,
  Transactional = 1,
  Reactive = 2,
  Cached = 3
}

enum Reentrance {
  PreventWithError = 1, // fail with error if there is an existing call in progress (default)
  WaitAndRestart = 0, // wait for existing call to finish and then restart current one
  CancelPrevious = -1, // cancel previous call in favor of recent one
  CancelAndWaitPrevious = -2, // cancel previous call in favor of recent one (but wait until canceling is completed)
  OverwritePrevious = -2, // allow previous to complete, but overwrite it with ignoring any conflicts
  RunSideBySide = -3 // multiple simultaneous calls are allowed
}

class Monitor {
  readonly isActive: boolean
  readonly counter: number
  readonly workers: ReadonlySet<Worker>
  static create(hint: string, activationDelay: number, deactivationDelay: number): Monitor
}

interface Worker {
  readonly id: number
  readonly hint: string
  isCanceled: boolean
  isFinished: boolean
  cancel(error?: Error, retryAfter?: Transaction): this
  whenFinished(): Promise<void>
}

interface LoggingOptions {
  readonly off: boolean
  readonly transaction: boolean
  readonly operation: boolean
  readonly step: boolean
  readonly monitor: boolean
  readonly read: boolean
  readonly write: boolean
  readonly change: boolean
  readonly obsolete: boolean
  readonly error: boolean
  readonly warning: boolean
  readonly gc: boolean
}

interface ProfilingOptions {
  repetitiveUsageWarningThreshold: number // default: 10 times
  mainThreadBlockingWarningThreshold: number // default: 16.6 ms
  asyncActionDurationWarningThreshold: number // default: 150 ms
}

// Transaction

type F<T> = (...args: any[]) => T

class Transaction implements Worker {
  static readonly current: Transaction

  readonly id: number
  readonly hint: string

  run<T>(func: F<T>, ...args: any[]): T
  wrap<T>(func: F<T>): F<T>
  apply(): void
  seal(): this // a1.seal().whenFinished().then(fulfill, reject)
  cancel(error?: Error, retryAfter?: Transaction): this
  isCanceled: boolean
  isFinished: boolean
  whenFinished(): Promise<void>
  join<T>(p: Promise<T>): Promise<T>

  static create(options: SnapshotOptions | null): Transaction
  static run<T>(options: SnapshotOptions | null, func: F<T>, ...args: any[]): T
  static off<T>(func: F<T>, ...args: any[]): T

  static isFrameOver(everyN: number, timeLimit: number): boolean
  static requestNextFrame(sleepTime: number): Promise<void>
  static isCanceled: boolean
}

// Controller

abstract class Controller<T> {
  readonly options: Options
  readonly args: ReadonlyArray<any>
  readonly value: T
  readonly error: any
  readonly stamp: number
  readonly isUpToDate: boolean

  configure(options: Partial<Options>): Options
  markObsolete(): boolean
  pullLastResult(args?: any[]): T | undefined
}

// Reactronic

class Reactronic {
  static why(short: boolean = false): string
  static getMethodCache<T>(method: F<T>): Cache<T>
  static configureCurrentOperation(options: Partial<Options>): Options
  static getRevisionOf(obj: any): number
  static takeSnapshot<T>(obj: T): T
  static dispose(obj: any): void
  static reactivityAutoStartDisabled: boolean
  static readonly isLogging: boolean
  static readonly loggingOptions: LoggingOptions
  static setLoggingMode(isOn: boolean, options?: LoggingOptions)
  static setLoggingHint<T extends object>(obj: T, name: string | undefined): void
  static getLoggingHint<T extends object>(obj: T): string | undefined
  static setProfilingMode(isOn: boolean, options?: Partial<ProfilingOptions>): void
}

```

## Contribution

By contributing, you agree that your contributions will be
automatically licensed under the Apache 2.0 license (see LICENSE file).
