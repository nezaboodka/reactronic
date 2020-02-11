
[![Readiness](https://img.shields.io/badge/release-beta-red.svg)](https://en.wikipedia.org/wiki/Software_release_life_cycle#Release_candidate)
[![GitHub License](https://img.shields.io/badge/license-MIT-4cc61e.svg?style=flat)](https://github.com/nezaboodka/reactronic/blob/master/LICENSE)
[![NPM Version](https://img.shields.io/npm/v/reactronic.svg?style=flat&colorB=success)](https://www.npmjs.com/package/reactronic)
[![Package Size](https://img.shields.io/bundlephobia/minzip/reactronic.svg?colorB=success)](https://bundlephobia.com/result?p=reactronic)
[![CircleCI Status](https://circleci.com/gh/nezaboodka/reactronic.svg?style=shield&circle-token=:circle-token)](https://circleci.com/gh/nezaboodka/reactronic)
![Coverage](https://img.shields.io/badge/coverage-96%25-success.svg)
![Lines](https://img.shields.io/badge/lines-1380-success.svg)
[![Demo](https://img.shields.io/badge/demo-live-success.svg)](https://nezaboodka.github.io/reactronic-demo/)

Live demo: https://nezaboodka.github.io/reactronic-demo/

# **Reactronic** - Transactionally Reactive State Management

Reactronic is a JavaScript library that provides
[transactionally reactive](https://blog.nezaboodka.com/post/2019/593-modern-database-should-natively-support-transactionally-reactive-programming)
state management in a Web application.

Transactional reactivity means that state changes are being made in an
isolated data snapshot and then, once atomically applied, are
**consistently propagated** to corresponding visual components for
(re)rendering. All that is done in automatic, seamless, and fine-grained
way, because reactronic **takes full care of tracking dependencies**
between visual components (observers) and state objects (observables).

## Conceptual Model

Transactional reactivity is based on four fundamental concepts:

  - **State** - a set of objects that store data of an application;
  - **Transaction** - a function that changes state objects in transactional (atomic) way;
  - **Trigger** - a function that is called automatically in response to state changes made by a transaction;
  - **Cache** - a computed value having associated function that is called on-demand to renew the value if it was invalidated.

The following picture illustrates relationships between the concepts
in the source code:

![Reactronic](https://github.com/nezaboodka/reactronic/raw/master/reactronic.jpg)

Below is the detailed description of each concept.

### State

State is a set of objects that store data of an application.
All state objects are transparently hooked to track access to
their properties, both on reads and writes.

``` typescript
class MyModel extends Stateful {
  url: string = "https://github.com/nezaboodka/reactronic"
  content: string = "transactionally reactive state management"
  timestamp: Date = Date.now()
}
```

In the example above, the class `MyModel` is based on Reactronic's
`Stateful` class and all its properties `url`, `content`, and `timestamp`
are hooked.

### Transaction

Transaction is a function that changes state objects in transactional
(atomic) way. Such a function is instrumented with hooks
to provide transparent atomicity (by implicit context switching
and isolation).

``` typescript
class MyModel extends Stateful {
  // ...
  @transaction
  async load(url: string): Promise<void> {
    this.url = url
    this.content = await fetch(url)
    this.timestamp = Date.now()
  }
}
```

In the example above, the function `load` is a transaction that makes
changes to `url`, `content` and `timestamp` properties. While the
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

Compensating actions are not needed in case of the transaction
failure, because all the changes made by the transaction in its
logical snapshot are simply discarded. In case the transaction
is successfully applied, affected caches are invalidated
and corresponding caching functions are re-executed in a proper
order (but only when all the data changes are fully applied).

Asynchronous operations (promises) are supported out of the box
during transaction execution. The transaction may consist of a set of
asynchronous calls prolonging the transaction until completion of
all of them. An asynchronous call may spawn other
asynchronous calls, which prolong transaction execution until
the whole chain of asynchronous operations is fully completed.

### Trigger & Cache

Trigger is a function that is immediately called in response to
state changes. Cache is a computed value having an associated
function that is called on-demand to renew the value if it was
invalidated. Trigger and cached functions are instrumented with
hooks to seamlessly subscribe to those state objects and other
cached functions (dependencies), which are used during their
execution.

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

  @trigger // called immediately in response to state changes
  pulse(): void {
    if (Cache.of(this.render).invalid)
      isolated(() => this.setState({})) // ask React to re-render
  } // pulse is subscribed to render

  shouldComponentUpdate(): boolean {
    return Cache.of(this.render).invalid
  }

  componentDidMount(): void {
    this.pulse() // initial trigger run
  }

  componentWillUnmount(): void {
    isolated(Cache.unmount, this)
  }
}
```

In the example above, `pulse` trigger is transparently subscribed
to the cached function `render`. In turn, the `render` function is
subscribed to the `url` and `content` properties of a corresponding
`MyModel` object. Once `url` or `content` values are changed, the
`render` cache becomes invalid and causes invalidation and immediate
re-execution of `pulse` trigger. While executed, the `pulse`
trigger function enqueues re-rendering request to React, which calls
`render` function causing it to renew its cached value.

In general case, all triggers and caches are automatically and
immediately marked as invalid when changes are made in those state
objects and cached functions that were used during their execution.
And once marked, the functions are automatically executed again,
either immediately (for @trigger functions) or on-demand
(for @cached functions).

Reactronic takes full care of tracking dependencies between
all the state objects and triggers/caches (observables and observers).
With Reactronic, you no longer need to create data change events
in one set of objects, subscribe to these events in other objects,
and manually maintain switching from the previous state to a new
one.

### Behavior Options

There are multiple options to configure behavior of transactional reactivity.

**Throttling** option defines how often trigger is revalidated:

  - `(ms)` - minimal delay in milliseconds between trigger revalidation;
  - `-1` - run trigger immediately once transaction is applied (synchronously);
  - `0` - run trigger immediately via event loop (asynchronously with zero timeout);
  - `Number.MAX_SAFE_INTEGER+` - never run trigger (disabled trigger).

**Reentrance** option defines how to handle reentrant calls of actions and triggers:

  - `Reentrance.PreventWithError` - fail with error if there is an existing call in progress;
  - `Reentrance.WaitAndRestart` - wait for previous call to finish and then restart current one;
  - `Reentrance.CancelPrevious` - cancel previous call in favor of recent one;
  - `CancelAndWaitPrevious` - cancel previous call in favor of recent one (but wait until canceling is completed)
  - `Reentrance.RunSideBySide` - multiple simultaneous calls are allowed.

**Monitor** is an object that maintains the status of running functions,
which it is attached to. A single monitor object can be shared between
multiple actions, triggers, and cache functions, thus maintaining
consolidated status for all of them (busy, workers, etc).

## Notes

Inspired by: MobX, Nezaboodka, Excel.

Key Reactronic principles and differentiators:

  - No compromises on consistency, clarity, and simplicity;
  - Minimalism and zero boilerplating (it's not a framework bloating your code);
  - Asynchrony, patches, undo/redo, conflict resolving are provided out of the box;
  - Seamless integration with transactionally reactive object-oriented databases like [Nezaboodka](https://nezaboodka.com/#products);
  - Compact dependency-free implementation consisting of just about 1K lines of code.

Roadmap:

  - v1.5: Patches and conflict resolution API
  - v1.7: History/undo/redo API and implementation
  - v2.0: Sync API and implementation

## Installation

NPM: `npm install reactronic`

## API (TypeScript)

```typescript
// Decorators & Operators

function stateless(proto, prop) // field only
function transaction(proto, prop, pd) // method only
function trigger(proto, prop, pd) // method only
function cached(proto, prop, pd) // method only

function incentiveArgs(incentiveArgs: boolean) // cached & triggers
function throttling(throttling: number) // triggers only
function reentrance(reentrance: Reentrance) // actions & triggers
function monitor(monitor: Monitor | null)
function trace(trace: Partial<Trace>)

function getCachedAndRevalidate<T>(method: F<Promise<T>>, args?: any[]): T | undefined
function nonreactive<T>(func: F<T>, ...args: any[]): T
function isolated<T>(func: F<T>, ...args: any[]): T

// Options, Kind, Reentrance, Monitor, Trace

interface Options {
  readonly kind: Kind
  readonly incentiveArgs: boolean
  readonly throttling: number // milliseconds, -1 is immediately (synchronously)
  readonly reentrance: Reentrance
  readonly monitor: Monitor | null
  readonly trace?: Partial<Trace>
}

enum Kind {
  Field = 0,
  Transaction = 1,
  Trigger = 2,
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
  readonly workerCount: number
  readonly workers: ReadonlySet<Worker>
  static create(hint?: string, delayBeforeIdle?: number): Monitor
}

interface Worker {
  readonly id: number
  readonly hint: string
  isCanceled: boolean
  isFinished: boolean
  cancel(error?: Error, retryAfter?: Transaction): this
  whenFinished(): Promise<void>
}

interface Trace {
  readonly silent: boolean
  readonly transactions: boolean
  readonly methods: boolean
  readonly steps: boolean
  readonly monitors: boolean
  readonly reads: boolean
  readonly writes: boolean
  readonly changes: boolean
  readonly invalidations: boolean
  readonly gc: boolean
}

interface ProfilingOptions {
  repetitiveReadWarningThreshold: number // default: 10 times
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

  static create(hint: string): Transaction
  static run<T>(hint: string, func: F<T>, ...args: any[]): T
  static runEx<T>(hint: string, separate: boolean, sidebyside: boolean,
    trace: Partial<Trace> | undefined, func: F<T>, ...args: any[]): T
  static isolated<T>(func: F<T>, ...args: any[]): T
}

// Cache

abstract class Cache<T> {
  readonly options: Options
  readonly args: ReadonlyArray<any>
  readonly value: T
  readonly error: any
  readonly stamp: number
  readonly invalid: boolean

  setup(options: Partial<Options>): Options
  invalidate(): boolean
  getCachedAndRevalidate(args?: any[]): T | undefined

  static of<T>(method: F<T>): Cache<T>
  static unmount(obj: any): void
}

// Reactronic

class Reactronic {
  static triggersAutoStartDisabled: boolean
  static readonly isTraceOn: boolean
  static readonly trace: Trace
  static setTrace(t: Trace | undefined)
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void
  static getTraceHint<T extends object>(obj: T): string | undefined
  static setProfilingMode(enabled: boolean, options?: Partial<ProfilingOptions>): void
}

```
