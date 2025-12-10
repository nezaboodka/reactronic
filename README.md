
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

Transactional reactivity means that state changes are
being made in an isolated data snapshot and then, once
atomically applied, are **consistently propagated** to
corresponding visual components for (re)rendering. All
that is done in automatic, seamless, and fine-grained
way. Reactronic **takes full care of tracking dependencies**
between visual components (reactive functions) and
application state (signalling objects).

Transactional reactivity is based on four fundamental
concepts:

  - **Signalling Objects** - a set of objects that store
    data of an application (state) and cause reactions
    upon their changes;
  - **Transactional Function** - a function that makes
    changes in signalling objects in atomic way ("all
    or nothing");
  - **Reactive Function** - a function that is
    (re-)executed in response to changes made in
    signalling objects by transactional functions;
  - **Cache Function** -  a function which result is
    remembered and, if becomes obsolete, causes
    function to re-execute on-demand.

Demo application built with Reactronic: https://nevod.io/#/playground.
Source code of the demo: https://gitlab.com/nezaboodka/nevod.web.public/-/blob/master/README.md.

Quick introduction and detailed description is below.

## Quick Introduction

Here is an example of transactional reactive code:

``` typescript
class Demo extends SignallingObject {
  name: string = 'Nezaboodka Software'
  email: string = 'contact@nezaboodka.com'

  @transaction
  saveContact(name: string, email: string): void {
    this.name = name
    this.email = email
  }

  @reaction
  printContact(): void {
    // depends on `name` and `email` and reacts to their changes
    if (this.email.indexOf('@') >= 0)
      throw new Error(`wrong email ${this.email}`)
    console.log(this.name + ' <' + this.email + '>')
  }
}
```

In the example above, `Demo` is a signalling object,
meaning that access to its fields are seamlessly tracked
to determine dependent reactive and cached functions.
Reactive function `printContact` reads `name` and `email`
fields, thus depends on them. It is executed automatically
in response to changes of these fields made by the
transactional function `saveContact`.

Here is an example of a cached result that is
(re-)computed on-demand:

``` typescript
class Demo extends SignallingObject {
  name: string = 'Nezaboodka Software'
  email: string = 'contact@nezaboodka.com'

  @cache
  get contact(): string {
    return this.name + ' <' + this.email + '>'
  }

  @reaction
  printContact(): void {
    if (this.contact !== '')
      Console.log(this.contact)
  }
}
```

In the example above, the result of `contact` getter is
computed from source fields `name` and `email`. Once
computed, the result is cached and is reused until
source fields `name` and `email` are changed. Once
source fields changed, `contact` result becomes obsolete,
thus causing execution of depending reactive function
`printContact`. When function of reactive function
`printContact` runs it reads `contact` and causes its
re-computation.

## Signalling Objects

Signalling objects are aimed to store data of
an application. All such objects are transparently hooked
to track access to their properties, both on reads and
writes.

``` typescript
class MyModel extends SignallingObject {
  url: string = "https://github.com/nezaboodka/reactronic"
  content: string = "transactional reactive state management"
  timestamp: Date = Date.now()
}
```

In the example above, the class `MyModel` is based on
Reactronic's `SignallingObject` class and all its
properties `url`, `content`, and `timestamp` are hooked.

## Transactional Function

Transactional function makes changes in signalling
objects in atomic way ("all or nothing"), thus provoking
execution of dependent reactive and cached functions.
Transactional function is instrumented with hooks to
provide transparent atomicity (by implicit context
switching and isolation).

``` typescript
class MyModel extends SignallingObject {
  // ...
  @transaction
  async load(url: string): Promise<void> {
    this.url = url
    this.content = await fetch(url)
    this.timestamp = Date.now()
  }
}
```

In the example above, the transactional function `load` makes
changes to `url`, `content` and `timestamp` properties.
While transactional function is running, the changes are visible
only inside the function itself. The new values become
atomically visible outside of the function only upon its
completion.

Atomicity is achieved by making changes in an isolated
data snapshot that is not visible outside of the running
function until it is fully finished and applied. Multiple
objects and their properties can be changed with full
respect to the all-or-nothing principle. To do so,
separate data snapshot is automatically maintained for
each transactional function. That is a logical snapshot
that does not create a full copy of all the data.

Compensating rollback operations are not needed in case
of a transactional function failure, because all the changes
made by transactional function in its logical snapshot are
simply discarded. In case a transaction function is
successfully applied, affected cached results are marked
as obsolete and corresponding caching functions are
re-executed in a proper order (but only when all the
data changes are fully applied).

Asynchronous operations (promises) are supported out of
the box during transactional function execution.
Transactional function may consist of a set of asynchronous
calls prolonging the function until completion of all of
them. An asynchronous call may spawn other asynchronous
calls, which prolong transactional execution until the whole
chain of asynchronous operations is fully completed.

## Reactive & Cached Functions

Reactive function is automatically and immediately called
in response to changes in signalling objects made by
transactional functions. Cached function is called on-demand
to renew the result if it was marked as obsolete due to
changes made by an transactional functions. Reactive and cached
functions are instrumented with hooks to seamlessly
subscribe to those signalling objects and other cached
functions (dependencies), which are used during their
execution.

``` tsx
class MyView extends Component<{model: MyModel}> {
  @cache
  render(): React.JSX.Element {
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
  @cache
  render(): React.JSX.Element {
    throw new Error('render method is undefined')
  }

  @reaction // called in response to changes
  ensureUpToDate(): void {
    if (this.shouldComponentUpdate()) {
      // Ask React to re-render
      Transaction.outside(() => this.setState({}))
    }
  } // EnsureUpToDate is subscribed to render

  shouldComponentUpdate(): boolean {
    const r = manageReaction(this.render)
    return !r.isUpToDate
  }

  componentDidMount(): void {
    // Run to subscribe for the first time
    this.ensureUpToDate()
  }

  componentWillUnmount(): void {
    runTransactional(disposeSignallingObject, this)
  }
}
```

In the example above, reactive function `refresh` is
transparently subscribed to the cached function `render`.
In turn, cached function `render` is subscribed to the
properties `url` and `content` of a corresponding `MyModel`
object. Once `url` or `content` values are changed, the
cached function `render` becomes obsolete and causes the
reactive function `refresh` to become obsolete and
re-executed. While being executed, the reactive function
`refresh` enqueues re-rendering request to React, which
calls cached function `render` causing it to renew its
cached value.

In general case, all reactive and cached functions
are automatically and immediately marked as obsolete
when changes are made in those signalling objects and
other cached results that were used during their
execution. And once marked, the functions are
automatically executed again, either immediately (for
reactive functions) or on-demand (for cached functions).

Reactronic takes full care of tracking dependencies
between all the signalling objects and reactive/cached
functions. With Reactronic, you no longer need to create
data change events in one set of objects, subscribe to
these events in other objects, and manually maintain
switching from the previous object version to a new one.

## Behavior Options

There are multiple options to configure behavior of
transactional reactivity.

**Order** options defines order of execution for
reactive functions:

  - (TBD)

**Throttling** option defines how often reactive function
is executed in case of recurring changes:

  - `(ms)` - minimal delay in milliseconds between executions;
  - `-1` - execute immediately once transactional function changes are applied (synchronously);
  - `0` - execute immediately via event loop (asynchronously with zero timeout);
  - `>= Number.MAX_SAFE_INTEGER` - never execute (suspended reaction).

**Reentrance** option defines how to handle reentrant calls of transactional
and reactive functions:

  - `preventWithError` - fail with error if there is an existing call in progress;
  - `waitAndRestart` - wait for previous call to finish and then restart current one;
  - `cancelPrevious` - cancel previous call in favor of recent one;
  - `cancelAndWaitPrevious` - cancel previous call in favor of recent one (but wait until canceling is completed)
  - `runSideBySide` - multiple simultaneous calls are allowed.

**Indicator** is an object that maintains status of running functions,
which it is attached to. A single indicator object can be shared between
multiple transactional, reactive, and cached functions, thus maintaining
consolidated status for all of them (busy, workers, etc).

## Notes

Inspired by: MobX, Nezaboodka, Excel.

Key Reactronic principles and differentiators:

  - No compromises on consistency, clarity, and simplicity;
  - Minimalism and zero boilerplating (it's not a framework bloating your code);
  - Async, patches, undo/redo, conflict resolving are provided out of the box;
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
class SignallingObject { }

// Decorators & Operators

function signal(boolean) // field only
function signal(proto, prop) // field only
function transaction(proto, prop, pd) // method only
function reaction(proto, prop, pd) // method only
function cache(proto, prop, pd) // method only
function options(value: Partial<ReactivityOptions>): F<any>

function runNonReactive<T>(func: F<T>, ...args: any[]): T
function runSensitive<T>(sensitivity: Sensitivity, func: F<T>, ...args: any[]): T

// SnapshotOptions, ReactivityOptions, Kind, Reentrance, Indicator, LoggingOptions, ProfilingOptions

export type SnapshotOptions = {
  readonly hint?: string
  readonly isolation?: Isolation
  readonly journal?: Journal
  readonly logging?: Partial<LoggingOptions>
  readonly token?: any
}

type ReactivityOptions = {
  readonly kind: Kind
  readonly isolation: Isolation
  readonly order: number
  readonly noSideEffects: boolean
  readonly signalArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately, Number.MAX_SAFE_INTEGER is never
  readonly reentrance: Reentrance
  readonly journal: Journal | undefined
  readonly indicator: Indicator | null
  readonly logging?: Partial<LoggingOptions>
}

enum Kind {
  plain = 0,
  transaction = 1,
  reaction = 2,
  cache = 3
}

enum Reentrance {
  preventWithError = 1, // fail with error if there is an existing call in progress (default)
  waitAndRestart = 0, // wait for existing call to finish and then restart current one
  cancelPrevious = -1, // cancel previous call in favor of recent one
  cancelAndWaitPrevious = -2, // cancel previous call in favor of recent one (but wait until canceling is completed)
  overwritePrevious = -2, // allow previous to complete, but overwrite it with ignoring any conflicts
  runSideBySide = -3 // multiple simultaneous calls are allowed
}

class Indicator {
  readonly isBusy: boolean
  readonly counter: number
  readonly workers: ReadonlySet<Worker>
  readonly busyDuration: number
  abstract whenBusy(): Promise<void>
  abstract whenIdle(): Promise<void>
  static create(hint: string, activationDelay: number, deactivationDelay: number): Indicator
}

type Worker = {
  readonly id: number
  readonly hint: string
  isCanceled: boolean
  isFinished: boolean
  cancel(error?: Error, retryAfter?: Transaction): this
  whenFinished(): Promise<void>
}

type LoggingOptions = {
  readonly off: boolean
  readonly transaction: boolean
  readonly operation: boolean
  readonly step: boolean
  readonly indicator: boolean
  readonly read: boolean
  readonly write: boolean
  readonly change: boolean
  readonly obsolete: boolean
  readonly error: boolean
  readonly warning: boolean
  readonly gc: boolean
}

type ProfilingOptions = {
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

// Operation

abstract class Operation<T> {
  readonly options: Options
  readonly args: ReadonlyArray<any>
  readonly value: T
  readonly error: any
  readonly stamp: number
  readonly isReusable: boolean

  configure(options: Partial<Options>): Options
  markObsolete(): boolean
  pullLastResult(args?: any[]): T | undefined
}

// ReactiveSystem

class ReactiveSystem {
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
