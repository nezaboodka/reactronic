
[![Readiness](https://img.shields.io/badge/release-beta-red.svg)](https://en.wikipedia.org/wiki/Software_release_life_cycle#Release_candidate)
[![GitHub License](https://img.shields.io/badge/license-MIT-4cc61e.svg?style=flat)](https://github.com/nezaboodka/reactronic/blob/master/LICENSE)
[![NPM Version](https://img.shields.io/npm/v/reactronic.svg?style=flat&colorB=success)](https://www.npmjs.com/package/reactronic)
[![Package Size](https://img.shields.io/bundlephobia/minzip/reactronic.svg?colorB=success)](https://bundlephobia.com/result?p=reactronic)
[![CircleCI Status](https://circleci.com/gh/nezaboodka/reactronic.svg?style=shield&circle-token=:circle-token)](https://circleci.com/gh/nezaboodka/reactronic)
![Coverage](https://img.shields.io/badge/coverage-94%25-success.svg)
![Lines](https://img.shields.io/badge/lines-1331-success.svg)
[![Demo](https://img.shields.io/badge/demo-live-success.svg)](https://nezaboodka.github.io/reactronic-demo/)

Live demo: https://nezaboodka.github.io/reactronic-demo/

# **Reactronic** - Transactionally Reactive State Management

Reactronic is a JavaScript library that provides
[transactionally reactive](https://blog.nezaboodka.com/post/2019/593-modern-database-should-natively-support-transactionally-reactive-programming)
state management in a Web application.

Transactional reactivity means that state changes are being made in an
isolated data snapshot and then, once atomically committed, are
**consistently propagated** to corresponding visual components for
(re)rendering. All that is done in automatic, seamless, and fine-grained
way, because reactronic **takes full care of tracking dependencies**
between visual components (observers) and state objects (observables).

## Conceptual Model

Transactional reactivity is based on four fundamental concepts:

  - **State** - a set of objects that store data of an application;
  - **Transaction** - a function that changes state objects in an atomic way;
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
  url: string = "https://github.com/nezaboodka/reactronic";
  content: string = "transactionally reactive state management";
  timestamp: Date = Date.now();
}
```

In the example above, the class `MyModel` is based on Reactronic's
`Stateful` class and all its properties `url`, `content`, and `timestamp`
are hooked.

### Transaction

Transaction is a function that changes state objects in an atomic way.
Every transaction function is instrumented with hooks to provide
transparent atomicity (by implicit context switching and isolation).

``` typescript
class MyModel extends Stateful {
  // ...
  @transaction
  async load(url: string): Promise<void> {
    this.url = url;
    this.content = await fetch(url);
    this.timestamp = Date.now();
  }
}
```

In the example above, the function `load` is a transaction
that makes changes to `url`, `content` and `timestamp` properties.
While the transaction is running, the changes are visible only inside
the transaction itself. The new values become atomically visible
outside of the transaction only upon its completion.

Atomicity is achieved by making changes in an isolated data
snapshot that is visible outside of the transaction (e.g.
displayed on user screen) only when it is finished. Multiple
objects and their properties can be changed with full respect
to the all-or-nothing principle. To do so, separate data
snapshot is automatically maintained for each transaction.
That is a logical snapshot that does not create a full copy
of all the data.

Compensating actions are not needed in case of the transaction
failure, because all the changes made by the transaction in its
logical snapshot are simply discarded. In case the transaction
is successfully committed, affected caches are invalidated
and corresponding caching functions are re-executed in a proper
order (but only when all the data changes are fully applied).

Asynchronous operations (promises) are supported out of the box
during transaction execution. The transaction may consist
of a set of asynchronous calls prolonging transaction until
completion of all of them. An asynchronous call may spawn other
asynchronous calls, which prolong transaction execution until
the whole chain of asynchronous operations is fully completed.

### Trigger & Cache

Trigger is a function that is immediately called in response to
state changes. Cache is a computed value having an associated
function that is called on-demand to renew the value if it was
invalidated.

Trigger and cached functions are instrumented with hooks to
seamlessly subscribe to those state objects and other cached
functions (dependencies), which are used during their execution.

``` tsx
class MyView extends React.Component<MyModel> {
  @trigger // called immediately in response to state changes
  autorefresh() {
    if (cacheof(this.render).isInvalid)
      this.setState({}); // telling React to re-render
  } // autorefresh is subscribed to render

  @cached
  render() {
    return (
      <div>
        <h1>{this.props.url}</h1>
        <div>{this.props.content}</div>
      </div>);
  } // render is subscribed to "url" and "content"
}
```

In the example above, `autorefresh` trigger is transparently subscribed
to the cached function `render`. In turn, the `render` function is
subscribed to the `url` and `content` properties of a corresponding
`MyModel` object. Once `url` or `content` values are changed, the
`render` cache becomes invalid and causes invalidation and immediate
re-execution of `autorefresh` trigger. While executed, the `autorefresh`
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

**Latency** option defines a delay between trigger invalidation and
invocation of the corresponding function:

  - `(ms)` - delay in milliseconds;
  - `-1` - rerun immediately (right after commit of a transaction);
  - `-2` - never rerun (disabled trigger).

**Reentrance** option defines how to handle reentrant calls of transactions and triggers:

  - `Reentrance.PreventWithError` - fail with error if there is an existing transaction in progress;
  - `Reentrance.WaitAndRestart` - wait for previous transaction to finish and then restart current one;
  - `Reentrance.CancelPrevious` - cancel previous transaction in favor of current one;
  - `Reentrance.RunSideBySide` - multiple simultaneous transactions are allowed.

**Monitor** option is an object that holds the status of running
functions, which it is attached to. A single monitor object can be
shared between multiple transaction and cache functions, thus
maintaining consolidated busy/idle status for all of them.

## Notes

Inspired by: MobX, Nezaboodka, Excel.

Key Reactronic principles and differentiators:

  - No compromises on consistency, clarity, and simplicity;
  - Minimalism and zero boilerplating (it's not a framework bloating your code);
  - Asynchrony, patches, undo/redo, conflict resolving are provided out of the box;
  - Seamless integration with transactionally reactive object-oriented databases like [Nezaboodka](https://nezaboodka.com/#products);
  - Compact dependency-free implementation consisting of just about 1K lines of code.

Roadmap:

  - v1.5: History/undo/redo API and implementation
  - v1.7: Patches and conflict resolution API
  - v2.0: Sync API and implementation

## Installation

NPM: `npm install reactronic`

## API (TypeScript)

```typescript
// Decorators

function stateful(proto, prop?); // field or class
function stateless(proto, prop); // field only
function transaction(proto, prop, pd); // method only
function trigger(proto, prop, pd); // method only
function cached(proto, prop, pd); // method only

function latency(latency: number); // triggers only
function reentrance(reentrance: Reentrance); // transactions & triggers
function monitor(monitor: Monitor | null);
function trace(trace: Partial<Trace>);

// Config, Kind, Reentrance, Monitor

interface Config {
  readonly kind: Kind;
  readonly latency: number; // milliseconds, -1 is immediately, -2 is never
  readonly reentrance: Reentrance;
  readonly monitor: Monitor | null;
  readonly trace?: Partial<Trace>;
}

enum Kind {
  Stateless = 0,
  Stateful = 1,
  Transaction = 2,
  Trigger = 3,
  Cached = 4,
}

enum Reentrance {
  PreventWithError = 1, // fail with error if there is an existing transaction in progress (default)
  WaitAndRestart = 0, // wait for existing transaction to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous transaction in favor of recent one
  RunSideBySide = -2, // multiple simultaneous transactions are allowed
}

class Monitor {
  readonly busy: boolean;
  readonly counter: number;
  static create(hint?: string): Monitor;
}

interface Trace {
  readonly silent: boolean;
  readonly transactions: boolean;
  readonly methods: boolean;
  readonly steps: boolean;
  readonly monitors: boolean;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly changes: boolean;
  readonly subscriptions: boolean;
  readonly invalidations: boolean;
  readonly gc: boolean;
}

// Transaction

type F<T> = (...args: any[]) => T;

class Transaction {
  constructor(hint: string);
  readonly id: number;
  readonly hint: string;
  run<T>(func: F<T>, ...args: any[]): T;
  wrap<T>(func: F<T>): F<T>;
  commit(): void;
  seal(): Transaction; // t1.seal().whenFinished().then(fulfill, reject)
  cancel(error?: Error, retryAfter?: Transaction);
  isCanceled(): boolean;
  isFinished(): boolean;
  whenFinished(): Promise<void>;
  join<T>(p: Promise<T>): Promise<T>;

  static readonly current: Transaction;

  static run<T>(hint: string, func: F<T>, ...args: any[]): T;
  static runAs<T>(hint: string, separate: boolean, trace: Partial<Trace> | undefined, func: F<T>, ...args: any[]): T;
  static outside<T>(func: F<T>, ...args: any[]): T;
}

// Cache

function cacheof<T>(method: F<T>): Cache<T>;
function resolved<T>(method: F<Promise<T>>, args?: any[]): T | undefined;
function nonreactive<T>(func: F<T>, ...args: any[]): T;
function standalone<T>(func: F<T>, ...args: any[]): T;

abstract class Cache<T> {
  configure(config: Partial<Config>): Config;
  readonly config: config;
  readonly args: ReadonlyArray<any>;
  readonly value: T;
  readonly error: any;
  readonly stamp: number;
  readonly isInvalid: boolean;
  invalidate(): boolean;
  call(args?: any[]): T | undefined;

  static of<T>(method: F<T>): Cache<T>;
  static unmount(...objects: any[]): Transaction;
}

// Reactronic

class Reactronic {
  static triggersAutoStartDisabled: boolean;
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void;
  static getTraceHint<T extends object>(obj: T): string | undefined;
  static setTrace(t: Trace | undefined);
  static readonly trace: Trace;
  static readonly isTraceOn: boolean;
}

```
