
[![Readiness](https://img.shields.io/badge/readiness-beta-orange.svg)](https://en.wikipedia.org/wiki/Software_release_life_cycle#Beta)
[![NPM Version](https://img.shields.io/npm/v/reactronic.svg?style=flat&colorB=success)](https://www.npmjs.com/package/reactronic)
[![Package Size](https://img.shields.io/bundlephobia/minzip/reactronic.svg?colorB=success)](https://bundlephobia.com/result?p=reactronic)
[![GitHub License](https://img.shields.io/badge/license-MIT-4cc61e.svg?style=flat)](https://github.com/nezaboodka/reactronic/blob/master/LICENSE)
[![CircleCI Status](https://circleci.com/gh/nezaboodka/reactronic.svg?style=shield&circle-token=:circle-token)](https://circleci.com/gh/nezaboodka/reactronic)
![Coverage](https://img.shields.io/badge/coverage-97%25-success.svg)
[![Demo](https://img.shields.io/badge/demo-live-success.svg)](https://nezaboodka.github.io/reactronic-demo/)

Live demo: https://nezaboodka.github.io/reactronic-demo/

# **Reactronic** - Transactionally Reactive State Management

Reactronic is a JavaScript library that provides
[transactionally reactive](https://blog.nezaboodka.com/post/2019/593-modern-database-should-natively-support-transactionally-reactive-programming)
state management in a Web application.

Transactional reactivity means that state changes are being made
in an isolated data snapshot and then, once atomically committed,
are **consistently propagated** to corresponding visual components
for (re)rendering. All that is done in automatic, seamless, and
fine-grained way.

## Conceptual Model

Transactional reactivity is based on the three fundamental concepts:

  - **State** - a set of objects that store data of an application;
  - **Transaction** - a function that changes state objects in an atomic way;
  - **Cache** - a computed value having associated function that is automatically called to renew the cache in response to state changes.

The following picture illustrates relationships between the concepts
in the source code:

![Reactronic](https://blog.nezaboodka.com/img/reactronic.jpg)

Below is the detailed description of each concept.

### State

State is a set of objects that store data of an application.
All state objects are transparently hooked to track access to
their properties, both on reads and writes.

``` typescript
@stateful
class MyModel {
  url: string = "https://github.com/nezaboodka/reactronic";
  content: string = "transactionally reactive state management";
  timestamp: Date = Date.now();
}
```

In the example above, the class `MyModel` is instrumented with the
`@stateful` decorator and its properties `url`, `content`, and `timestamp`
are hooked.

### Transaction

Transaction is a function that changes state objects in an atomic way.
Every transaction function is instrumented with hooks to provide
transparent atomicity (by implicit context switching and isolation).

``` typescript
@stateful
class MyModel {
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
is successfully committed, affected caches are marked as outdated
and corresponding caching functions are re-executed in a proper
order (but only when all the data changes are fully applied).

Asynchronous operations (promises) are supported out of the box
during transaction execution. The transaction may consist
of a set of asynchronous calls prolonging transaction until
completion of all of them. An asynchronous call may spawn other
asynchronous calls, which prolong transaction execution until
the whole chain of asynchronous operations is fully completed.

### Cache

Cache is a computed value having an associated function that
is automatically called to renew the cache in response to state
changes. Each cache function is instrumented with hooks to
transparently subscribe it to those state object properties
and other caches, which it uses during execution.

``` tsx
class MyView extends React.Component<MyModel> {
  @cache  @behavior(Renew.OnDemand)
  render() {
    const m: MyModel = this.props; // just a shortcut
    return (
      <div>
        <h1>{m.url}</h1>
        <div>{m.content}</div>
      </div>
    );
  } // render is subscribed to m.url and m.content

  @cache  @behavior(Renew.Immediately)
  trigger(): void {
    if (cacheof(this.render).isOutdated)
      this.setState({}); // ask React to re-render
  } // trigger is subscribed to render
}
```

In the example above, the cache of the `trigger` function is
transparently subscribed to the cache of the `render` function.
In turn, the `render` function is subscribed to the `url` and
`content` properties of a corresponding `MyModel` object.
Once `url` or `content` values are changed, the `render` cache
becomes outdated and causes the `trigger` cache to become
outdated as well (cascaded). The `trigger` cache is marked for
immediate renewal, thus its function is immediately called by
Reactronic to renew the cache. While executed, the `trigger`
function enqueues re-rendering request to React, which calls
`render` function and it renews its cache marked for on-demand
renew.

In general case, cache is automatically and immediately marked
as outdated when changes are made in those state object properties
that were used by its function. And once marked, the function
is automatically executed again to renew it, either immediately or
on demand.

Reactronic **takes full care of tracking dependencies** between
all the state objects and caches (observers and observables).
With Reactronic, you no longer need to create data change events
in one set of objects, subscribe to these events in other objects,
and manually maintain switching from the previous state to a new
one.

### Advanced Options

There are multiple options to fine tune transactional reactivity.

**Latency** option defines a delay between cache invalidation and
invocation of the caching function to renew the cache:

  - `(ms)` - delay in milliseconds;
  - `Renew.Immediately` - renew immediately with zero latency;
  - `Renew.OnDemand` - renew on access if cache is outdated;
  - `Renew.Manually` - manual renew (explicit only);
  - `Renew.NoCache` - renew on every call of the function.

**SeparateFrom** set of flags defines if transaction is executed separately from reaction, parent, and children transactions (flags can be combined with bitwise operator):

  - `SeparateFrom.Reaction` - transaction is separated from its reaction (default);
  - `SeparateFrom.Parent` - transaction is separated from parent (caller) transactions;
  - `SeparateFrom.Children` - transaction is separated from children (callee) transactions;
  - `SeparateFrom.All` - transaction is separated from reactions, parents, and children.

**ReentrantCall** option defines how to handle reentrant calls of the same transactional function:

  - `ReentrantCall.ExitWithError` - fail with error if there is an existing transaction in progress;
  - `ReentrantCall.WaitAndRestart` - wait for previous transaction to finish and then restart current one;
  - `ReentrantCall.CancelPrevious` - cancel previous transaction in favor of current one;
  - `ReentrantCall.RunSideBySide` - multiple simultaneous transactions are allowed.

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
  - Seamless integration with transactionally reactive object-oriented databases like [Nezaboodka](https://nezaboodka.com/#products).

Roadmap:

  - v1.5: History/undo/redo API and implementation
  - v1.7: Patches and conflict resolition API
  - v2.0: Sync API and implementation

## Installation

NPM: `npm install reactronic`

## API (TypeScript)

```typescript
// Decorators

function stateful(proto, prop?); // class, field, method
function stateless(proto, prop); // field, method
function transaction(proto, prop, pd); // method only
function cache(proto, prop, pd); // method only

function behavior(latency: Latency, reentrant: ReentrantCall, separate: SeparateFrom);
function monitor(value: Monitor | null);
function config(config: Partial<Config>);

// Config, Latency, ReentrantCall, SeparateFrom, Monitor

interface Config {
  readonly stateful: boolean;
  readonly latency: Latency;
  readonly reentrant: ReentrantCall;
  readonly separate: SeparateFrom;
  readonly monitor: Monitor | null;
  readonly trace?: Partial<Trace>;
}

type Latency = number | Renew; // milliseconds

enum Renew {
  Immediately = -1,
  WhenReady = -2,
  OnDemand = -3, // default for cache
  Manually = -4,
  NoCache = -5, // default for transaction
}

enum ReentrantCall {
  ExitWithError = 1, // fail with error if there is an existing transaction in progress (default)
  WaitAndRestart = 0, // wait for existing transaction to finish and then restart reentrant one
  CancelPrevious = -1, // cancel previous transaction in favor of recent one
  RunSideBySide = -2, // multiple simultaneous transactions are allowed
}

enum SeparateFrom {
  None = 0,
  Reaction = 1,
  Parent = 2,
  Children = 4,
  All = 1 | 2 | 4,
}

@stateful
class Monitor {
  readonly isIdle: boolean;
  readonly volume: number;
  readonly message: string;
  constructor(hint: string);
}

interface Trace {
  readonly transactions: boolean;
  readonly methods: boolean;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly changes: boolean;
  readonly subscriptions: boolean;
  readonly outdating: boolean;
  readonly gc: boolean;
  readonly silent: boolean;
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
  static run<T>(func: F<T>, ...args: any[]): T;
  static runAs<T>(hint: string, separate: SeparateFrom, trace: Partial<Trace> | undefined, func: F<T>, ...args: any[]): T;
  static readonly active: Transaction;
}

// Cache

function resultof<T>(method: F<Promise<T>>, ...args: any[]): T | undefined;
function cacheof<T>(method: F<T>, ...args: any[]): Cache<T>;

abstract class Cache<T> {
  readonly config: Config;
  configure(config: Partial<Config>): Config;
  readonly error: any;
  getResult(...args: any[]): T;
  readonly isOutdated: boolean;
  markOutdated(cause: string | undefined): boolean;
  static get<T>(method: F<Promise<T>>): ReactiveCache<T>;
  static get<T>(method: F<T>): ReactiveCache<T>;
  static unmount(...objects: any[]): Transaction;
}
```
