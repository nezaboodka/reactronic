// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2025 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "../util/Dbg.js"
import { Uri } from "../util/Uri.js"
import { LoggingOptions } from "../Logging.js"
import { LinkedList, LinkedItem, Mark, LinkedSubList } from "../util/LinkedList.js"
import { emitLetters, flags, flagsAny, getCallerInfo, proceedSyncOrAsync } from "../util/Utils.js"
import { Priority, Mode, Isolation, Reentrance } from "../Enums.js"
import { ReactivityOptions } from "../Options.js"
import { RxObject } from "../core/Mvcc.js"
import { Transaction } from "../core/Transaction.js"
import { RtSystem, options, signal, reaction, runTransactional, runNonReactive, manageReaction, disposeRxObject } from "../System.js"

// ConfOrScript

export type ConfOrScript<E> = Conf<E> | Script<E>

// Script, ScriptTask, Handler

export type Script<E> = (this: E, o: E, basis: () => void) => void
export type ScriptTask<E> = (this: E, o: E, basis: () => Promise<void>) => Promise<void>
export type Handler<E = unknown, R = void> = (o: E) => R

// Conf

export type Conf<E = unknown> = {
  setup?: Script<E>                // настройка
  setupTask?: ScriptTask<E>        // настройка-задача
  creation?: Script<E>             // создание
  creationTask?: ScriptTask<E>     // создание-задача
  mounting?: Script<E>             // монтаж
  destruction?: Script<E>          // уничтожение
  caption?: string                 // заголовок
  driver?: Driver<E>               // драйвер
  key?: string                     // ключ
  mode?: Mode                      // режим
  signalArgs?: unknown             // аргументы-сигналы
  unmounted?: boolean,             // размонтировано
  basis?: ConfOrScript<E>          // базис
}

// launchReactiveTree

export function launchReactiveTree<T>(func: (...args: any[]) => T, ...args: any[]): T {
  return Transaction.isolate<T>(runInsideContextOfNode, undefined, func, ...args)
}

// RtElement

export function RtElement<E>(conf?: ConfOrScript<E>): RtNode<E> {
  // Normalization
  conf = norm(conf) ?? {}
  const driver = getDriverUsingBasisChain<E>(conf)
  if (driver === undefined)
    throw misuse("driver is required to produce an element")
  const caption = getProducerUsingBasisChain<E>(conf)
  // Production
  const owner = gCurrentNode
  let key = conf.key
  let result: RtNode$<E>
  if (owner) {
    let existing = owner.driver.produceChild(owner, driver, conf, norm(conf.basis))
    // Reuse existing node or produce a new one
    const renovation = owner.children.renovation
    existing ??= renovation.tryReaffirm(
      key = key || generateKey(caption, owner), undefined,
      "nested elements can be produced inside 'setup' only")
    if (existing) {
      // Reuse existing node
      result = existing as RtNode$<E>
      if (result.driver !== driver && driver !== undefined)
        throw misuse(`changing element driver is not yet supported: "${result.driver.id}" -> "${driver.id}"`)
      const exSignalArgs = result.conf.signalArgs
      if (signalsAreEqual(conf.signalArgs, exSignalArgs))
        conf.signalArgs = exSignalArgs // preserve signal args instance
      result.conf = conf
    }
    else {
      // Create new node
      result = new RtNode$<E>(key || generateKey(caption, owner), driver, conf, owner)
      renovation.thisIsAdded(result as RtNode$<unknown>) as RtNode$<E>
    }
  }
  else {
    // Create new root node
    result = new RtNode$(key || generateKey(caption, owner), driver, conf, owner)
    RtNode.launchSetup(result, conf.signalArgs)
  }
  return result
}

// norm

export function norm<E = void>(arg: ConfOrScript<E> | undefined): Conf<E> | undefined {
  if (arg instanceof Function)
    arg = conf(arg)
  return arg
}

// conf

export function conf<E = void>(
  setup?: Script<E>,
  setupTask?: ScriptTask<E>,
  creation?: Script<E>,
  creationTask?: ScriptTask<E>,
  mounting?: Script<E>,
  destruction?: Script<E>,
  caption?: string,
  key?: string,
  mode?: Mode,
  signalArgs?: unknown,
  unmounted?: boolean,
  basis?: Conf<E>): Conf<E> {
  //
  return {
    setup, setupTask, creation, creationTask, mounting, destruction,
    caption, key, mode, signalArgs, unmounted, basis }
}

// inherit

export function inherit<E>(cos: ConfOrScript<E> | undefined, basis: ConfOrScript<E>): ConfOrScript<E> {
  cos = norm(cos)
  if (cos !== undefined) {
    let tail = cos
    while (tail.basis !== undefined) {
      const next = tail.basis
      if (next instanceof Function)
        tail = tail.basis = { setup: next }
      else
        tail = next
    }
    tail.basis = basis
  }
  else
    cos = basis
  return cos
}

// RtNode

export abstract class RtNode<E = unknown> extends LinkedItem<RtNode<E>> {
  static readonly shortFrameDuration = 16 // ms
  static readonly longFrameDuration = 300 // ms
  static frameDuration = RtNode.longFrameDuration
  static currentNodePriority = Priority.realtime

  abstract readonly key: string
  abstract readonly conf: Readonly<Conf<E>/* | ConfAsync<E>*/>
  abstract readonly level: number
  abstract readonly owner: RtNode
  abstract element: E
  abstract readonly host: RtNode
  abstract readonly children: LinkedList<RtNode>
  abstract readonly stamp: number
  abstract readonly outer: RtNode
  abstract readonly context: RtNodeContext | undefined
  abstract priority?: Priority
  abstract childrenShuffling: boolean
  abstract strictOrder: boolean
  abstract getUri(relativeTo?: RtNode<any>): string
  abstract has(mode: Mode): boolean
  abstract hasAny(mode: Mode): boolean
  abstract configureReactivity(options: Partial<ReactivityOptions>): ReactivityOptions

  static get current(): RtNode {
    return RtNode$.node
  }

  static get isInitialSetup(): boolean {
    return RtNode.current.stamp === 1
  }

  static launchSetup(node: RtNode<any>, signalArgs: unknown): void {
    const impl = node as RtNode$<any>
    const conf = impl.conf
    if (node.stamp >= Number.MAX_SAFE_INTEGER || !signalsAreEqual(signalArgs, conf.signalArgs)) {
      conf.signalArgs = signalArgs // remember new signalArgs
      launchSetupImpl(impl)
    }
  }

  static launchDestruction(node: RtNode<any>): void {
    const impl = node as RtNode$<any>
    launchDestructionImpl(impl, true, true)
  }

  static launchNestedNodesThenDo(action: (error: unknown) => void): void {
    launchNestedNodesThenDoImpl(RtNode$.node, undefined, action)
  }

  static markAsMounted(node: RtNode<any>, yes: boolean): void {
    const n = node as RtNode$<any>
    if (n.stamp < 0)
      throw misuse("deactivated node cannot be mounted or unmounted")
    if (n.stamp >= Number.MAX_SAFE_INTEGER)
      throw misuse("node must be activated before mounting")
    n.stamp = yes ? 0 : Number.MAX_SAFE_INTEGER - 1
  }

  lookupTreeNodeByUri<E = unknown>(uri: string): RtNode<E> | undefined {
    const t = Uri.parse(uri)
    if (t.authority !== this.key)
      throw misuse(`authority '${t.authority}' doesn't match root node key '${this.key}'`)
    const segments = t.path.split("/")
    let result = this as RtNode<any>
    for (let i = 1; i < segments.length && result !== undefined; i++)
      result = result.children.lookup(segments[i]) as RtNode<E>
    return result
  }

  static findMatchingHost<E = unknown, R = unknown>(
    node: RtNode<E>, match: Handler<RtNode<E>, boolean>): RtNode<R> | undefined {
    let p = node.host as RtNode<any>
    while (p !== p.host && !match(p))
      p = p.host
    return p
  }

  static findMatchingPrevSibling<E = unknown, R = unknown>(
    node: RtNode<E>, match: Handler<RtNode<E>, boolean>): RtNode<R> | undefined {
    let p = node.prev
    while (p && !match(p))
      p = p.prev
    return p as RtNode<R> | undefined
  }

  static forEachChildRecursively<E = unknown>(
    node: RtNode<E>, action: Handler<RtNode<E>>): void {
    action(node)
    for (const child of node.children.items())
      RtNode.forEachChildRecursively<E>(child as RtNode<any>, action)
  }

  static getDefaultLoggingOptions(): LoggingOptions | undefined {
    return RtNode$.logging
  }

  static setDefaultLoggingOptions(logging?: LoggingOptions): void {
    RtNode$.logging = logging
  }
}

// Driver

export type Driver<E = unknown> = {
  readonly id: string,
  readonly isPartition: boolean,
  readonly initialize?: Handler<E>

  create(node: RtNode<E>): E

  runCreation(node: RtNode<E>): void

  runDestruction(node: RtNode<E>, isLeader: boolean): boolean

  runMount(node: RtNode<E>): void

  runSetup(node: RtNode<E>): void | Promise<void>

  produceChild(ownerNode: RtNode<E>,
    childDriver: Driver<any>,
    childConf?: Conf<any>,
    childBasis?: Conf<any>): LinkedItem<RtNode> | undefined

  provideHost(node: RtNode<E>): RtNode<E>
}

// RtNodeContext

export type RtNodeContext<T extends Object = Object> = {
  variable: RtVariable<T>
  value: T
}

// RtDriver

export abstract class RtDriver<E = unknown> implements Driver<E> {
  constructor(
    readonly id: string,
    readonly isPartition: boolean,
    readonly initialize?: Handler<E>) {
  }

  abstract create(node: RtNode<E>): E

  runCreation(node: RtNode<E>): void | Promise<void> {
    this.initialize?.(node.element)
    return invokeCreationUsingBasisChain(node.element, node.conf)
  }

  runDestruction(node: RtNode<E>, isLeader: boolean): boolean {
    invokeDestructionUsingBasisChain(node.element, node.conf)
    return isLeader // treat children as deactivation leaders as well
  }

  runMount(node: RtNode<E>): void {
    invokeMountingUsingBasisChain(node.element, node.conf)
  }

  runSetup(node: RtNode<E>): void | Promise<void> {
    return invokeSetupUsingBasisChain(node.element, node.conf)
  }

  produceChild(ownerNode: RtNode<E>,
    childDriver: Driver<any>,
    childConf?: Conf<any>,
    childBasis?: Conf<any>): LinkedItem<RtNode> | undefined {
    return undefined
  }

  provideHost(node: RtNode<E>): RtNode<E> {
    return node
  }
}

// ReactiveTreeVariable

export class RtVariable<T extends Object = Object> {
  readonly hint: string
  readonly defaultValue: T | undefined

  constructor(hint: string, defaultValue?: T) {
    this.hint = hint
    this.defaultValue = defaultValue
  }

  set value(value: T) {
    RtNode$.setTreeVariableValue(this, value)
  }

  get value(): T {
    return RtNode$.useTreeVariableValue(this)
  }

  get valueOrUndefined(): T | undefined {
    return RtNode$.tryUseTreeVariableValue(this)
  }
}

// Utils

export function generateKey(caller?: string, owner?: RtNode$): string {
  const n = owner !== undefined ? owner.sequencer++ : 0
  const lettered = emitLetters(n)
  let result: string
  if (RtSystem.isLogging)
    result = `·${caller ?? "???"}·${getCallerInfo(lettered)}`
  else
    result = `·${caller ?? "???"}·${lettered}`
  return result
}

function tryAsConf<E>(cos: ConfOrScript<E> | undefined): Conf<E> | undefined {
  return (typeof cos === "object" ? cos : undefined)
}

export function getDriverUsingBasisChain<E>(conf?: Conf<E>): Driver<E> | undefined {
  return conf?.driver ?? (conf?.basis ? getDriverUsingBasisChain(tryAsConf(conf?.basis)) : undefined)
}

export function getProducerUsingBasisChain<E>(conf?: Conf<E>): string | undefined {
  return conf?.caption ?? (conf?.basis ? getProducerUsingBasisChain(tryAsConf(conf?.basis)) : undefined)
}

export function getModeUsingBasisChain<E>(conf?: Conf<E>): Mode {
  return conf?.mode ?? (conf?.basis ? getModeUsingBasisChain(tryAsConf(conf?.basis)) : Mode.default)
}

function invokeSetupUsingBasisChain(el: unknown, cos: ConfOrScript<any>): void | Promise<void> {
  let result: void | Promise<void> = undefined
  const basis = typeof cos === "object" ? cos.basis : undefined
  const setup = typeof cos === "object" ? cos.setup : cos
  const setupTask = tryAsConf(cos)?.setupTask
  if (setup && setupTask)
    throw misuse("'setup' and 'setupTask' cannot be defined together")
  if (setup)
    result = setup.call(el, el, basis ? () => invokeSetupUsingBasisChain(el, basis) : NOP)
  else if (setupTask)
    result = setupTask.call(el, el, basis ? () => invokeSetupUsingBasisChain(el, basis) : NOP_ASYNC)
  else if (basis)
    result = invokeSetupUsingBasisChain(el, basis)
  return result
}

function invokeCreationUsingBasisChain(el: unknown, cos: ConfOrScript<any>): void | Promise<void> {
  let result: void | Promise<void> = undefined
  const c = tryAsConf(cos)
  const basis = c?.basis
  const creation = c?.creation
  const creationTask = c?.creationTask
  if (creation && creationTask)
    throw misuse("'creation' and 'creationTask' cannot be defined together")
  if (creation)
    result = creation.call(el, el, basis ? () => invokeCreationUsingBasisChain(el, basis) : NOP)
  else if (creationTask)
    result = creationTask.call(el, el, basis ? () => invokeCreationUsingBasisChain(el, basis) : NOP_ASYNC)
  else if (basis)
    result = invokeCreationUsingBasisChain(el, basis)
  return result
}

function invokeMountingUsingBasisChain(el: unknown, cos: ConfOrScript<any>): void {
  const c = tryAsConf(cos)
  const basis = c?.basis
  const mounting = c?.mounting
  if (mounting)
    mounting.call(el, el, basis ? () => invokeMountingUsingBasisChain(el, basis) : NOP)
  else if (basis)
    invokeMountingUsingBasisChain(el, basis)
}

function invokeDestructionUsingBasisChain(el: unknown, cos: ConfOrScript<any>): void {
  const c = tryAsConf(cos)
  const basis = c?.basis
  const destruction = c?.destruction
  if (destruction)
    destruction.call(el, el, basis ? () => invokeDestructionUsingBasisChain(el, basis) : NOP)
  else if (basis)
    invokeDestructionUsingBasisChain(el, basis)
}

// RtNodeContext$

class RtNodeContext$<T extends Object = Object> extends RxObject implements RtNodeContext<T> {
  @signal(false) next: RtNodeContext$<object> | undefined
  @signal(false) variable: RtVariable<T>
  value: T

  constructor(variable: RtVariable<T>, value: T) {
    super()
    this.next = undefined
    this.variable = variable
    this.value = value
  }
}

// RtNode$

class RtNode$<E = unknown> extends RtNode<E> {
  static logging: LoggingOptions | undefined = undefined
  static grandNodeCount: number = 0
  static disposableNodeCount: number = 0

  readonly key: string
  driver: Driver<E>
  conf: Conf<E>
  readonly level: number
  readonly owner: RtNode$
  readonly element: E
  host: RtNode
  readonly children: LinkedList<RtNode>
  stamp: number
  outer: RtNode$
  context: RtNodeContext$<any> | undefined
  sequencer: number
  priority: Priority
  childrenShuffling: boolean

  constructor(
    key: string,
    driver: Driver<E>,
    conf: Readonly<Conf<E>>,
    owner: RtNode$ | undefined) {
    super()
    const thisAsUnknown = this as RtNode$<unknown>
    this.key = key
    this.driver = driver
    this.conf = conf
    if (owner) {
      const node = owner
      this.level = node.level + 1
      this.owner = owner
      this.outer = node.context ? owner : node.outer
    }
    else {
      this.level = 1
      this.owner = owner = thisAsUnknown
      this.outer = thisAsUnknown
    }
    this.element = driver.create(this)
    this.host = thisAsUnknown // node is unmounted
    this.children = new LinkedList<RtNode>(getNodeKey, true)
    this.stamp = Number.MAX_SAFE_INTEGER // newly created
    this.context = undefined
    this.sequencer = 0
    this.priority = Priority.realtime
    this.childrenShuffling = false
    // Monitoring
    RtNode$.grandNodeCount++
    if (!this.has(Mode.primitive))
      RtNode$.disposableNodeCount++
  }

  getUri(relativeTo?: RtNode<any>): string {
    const path: Array<string> = []
    const authority = gatherAuthorityAndPath(this, path)
    const result = Uri.from({
      scheme: "node",
      authority,
      path: "/" + path.join("/"),
    })
    return result.toString()
  }

  get strictOrder(): boolean {
    return this.children.isStrictOrder
  }

  set strictOrder(value: boolean) {
    this.children.isStrictOrder = value
  }

  get isMoved(): boolean {
    return this.mark === Mark.moved
  }

  has(mode: Mode): boolean {
    return flags(getModeUsingBasisChain(this.conf), mode)
  }

  hasAny(mode: Mode): boolean {
    return flagsAny(getModeUsingBasisChain(this.conf), mode)
  }

  @reaction
  @options({
    reentrance: Reentrance.cancelAndWaitPrevious,
    allowObsoleteToFinish: true,
    signalArgs: true,
    noSideEffects: false,
  })
  setup(_signalArgs: unknown): void {
    // signalArgs parameter is used to enforce setup run by owner
    runSetupNow(this)
  }

  configureReactivity(options: Partial<ReactivityOptions>): ReactivityOptions {
    if (this.stamp < Number.MAX_SAFE_INTEGER - 1 || this.has(Mode.primitive))
      throw misuse("reactivity can be configured only for elements with non-primitive mode and only during creation")
    return manageReaction(this.setup).configure(options)
  }

  static get node(): RtNode$ {
    if (!gCurrentNode)
      throw misuse("current node is undefined")
    return gCurrentNode
  }

  static tryUseTreeVariableValue<T extends Object>(variable: RtVariable<T>): T | undefined {
    let node = RtNode.current
    while (node.context?.variable !== variable && node.owner !== node)
      node = node.outer
    const ctx = node.context as RtNodeContext<T>
    return ctx?.variable === variable ? ctx.value : undefined
  }

  static useTreeVariableValue<T extends Object>(variable: RtVariable<T>): T {
    const result = RtNode$.tryUseTreeVariableValue(variable) ?? variable.defaultValue
    if (!result)
      throw misuse("unknown node variable")
    return result
  }

  static setTreeVariableValue<T extends Object>(variable: RtVariable<T>, value: T | undefined): void {
    const node = RtNode$.node
    const owner = node.owner
    const hostCtx = runNonReactive(() => owner.context?.value)
    if (value && value !== hostCtx) {
      if (hostCtx)
        node.outer = owner
      else
        node.outer = owner.outer
      runTransactional({ isolation: Isolation.joinAsNestedTransaction }, () => {
        const ctx = node.context
        if (ctx) {
          ctx.variable = variable
          ctx.value = value // update context thus invalidate reactions
        }
        else
          node.context = new RtNodeContext$<any>(variable, value)
      })
    }
    else if (hostCtx)
      node.outer = owner
    else
      node.outer = owner.outer
  }
}

// Internal

function gatherAuthorityAndPath<T>(node: RtNode<T>, path: Array<string>, relativeTo?: RtNode<any>): string {
  let authority: string
  if (node.owner !== node && node.owner !== relativeTo) {
    authority = gatherAuthorityAndPath(node.owner, path)
    path.push(node.key)
  }
  else
    authority = node.key
  return authority
}

function getNodeKey(node: RtNode): string | undefined {
  return node.stamp >= 0 ? node.key : undefined
}

function launchNestedNodesThenDoImpl(node: RtNode$<any>, error: unknown, action: (error: unknown) => void): void {
  runInsideContextOfNode(node, () => {
    const owner = node
    const children = owner.children
    if (children.isRenovationInProgress) {
      let promised: Promise<void> | undefined = undefined
      try {
        const renovation = children.endRenovation(error)
        // Deactivate removed elements
        for (const child of renovation.lostItems())
          launchDestructionImpl(child as RtNode$, true, true)
        if (!error) {
          // Lay out and update actual elements
          const sequential = children.isStrictOrder
          let p1: Array<RtNode$> | undefined = undefined
          let p2: Array<RtNode$> | undefined = undefined
          let mounting = false
          let partition = owner
          for (const c of children.items()) {
            if (Transaction.isCanceled)
              break
            const child = c as RtNode$
            const isPartition = child.driver.isPartition
            const host = isPartition ? owner : partition
            mounting = markToMountIfNecessary(
              mounting, host, child, children, sequential)
            const p = child.priority ?? Priority.realtime
            if (p === Priority.realtime)
              launchSetupImpl(child as RtNode$) // synchronously
            else if (p === Priority.normal)
              p1 = push(child, p1) // defer for P1 async setup build
            else
              p2 = push(child, p2) // defer for P2 async setup build
            if (isPartition)
              partition = child
          }
          // Build setups for incremental children (if any)
          if (!Transaction.isCanceled && (p1 !== undefined || p2 !== undefined))
            promised = startIncrementalNestedScriptsRun(node, children, p1, p2).then(
              () => action(error),
              e => action(e))
        }
      }
      finally {
        if (!promised)
          action(error)
      }
    }
  })
}

function markToMountIfNecessary(mounting: boolean, host: RtNode,
  node: RtNode$, children: LinkedList<RtNode>, sequential: boolean): boolean {
  // Detects element mounting when artificial elements
  // exist among regular elements having native HTML elements
  if (node.conf.unmounted)
    host = node
  if (!node.hasAny(Mode.fragment | Mode.external)) {
    if (mounting || node.host !== host) {
      LinkedItem.setStatus$(node as RtNode, Mark.moved, node.rank)
      mounting = false
    }
  }
  else if (sequential && node.mark === Mark.moved)
    mounting = true // apply to the first element having native HTML element
  node.host = host
  return mounting
}

async function startIncrementalNestedScriptsRun(
  ownerNode: RtNode$,
  allChildren: LinkedList<RtNode>,
  priority1?: Array<RtNode$>,
  priority2?: Array<RtNode$>): Promise<void> {
  const stamp = ownerNode.stamp
  if (priority1)
    await runNestedScriptsIncrementally(ownerNode, stamp, allChildren, priority1, Priority.normal)
  if (priority2)
    await runNestedScriptsIncrementally(ownerNode, stamp, allChildren, priority2, Priority.background)
}

async function runNestedScriptsIncrementally(owner: RtNode$, stamp: number,
  allChildren: LinkedList<RtNode>, items: Array<RtNode$>,
  priority: Priority): Promise<void> {
  await Transaction.requestNextFrame()
  const node = owner
  if (!Transaction.isCanceled || !Transaction.isFrameOver(1, RtNode$.shortFrameDuration / 3)) {
    let outerPriority = RtNode$.currentNodePriority
    RtNode$.currentNodePriority = priority
    try {
      if (node.childrenShuffling)
        shuffle(items)
      const frameDurationLimit = priority === Priority.background ? RtNode.shortFrameDuration : Infinity
      let frameDuration = Math.min(frameDurationLimit, Math.max(RtNode.frameDuration / 4, RtNode.shortFrameDuration))
      for (const child of items) {
        launchSetupImpl(child)
        if (Transaction.isFrameOver(1, frameDuration)) {
          RtNode$.currentNodePriority = outerPriority
          await Transaction.requestNextFrame(0)
          outerPriority = RtNode$.currentNodePriority
          RtNode$.currentNodePriority = priority
          frameDuration = Math.min(4 * frameDuration, Math.min(frameDurationLimit, RtNode.frameDuration))
        }
        if (Transaction.isCanceled && Transaction.isFrameOver(1, RtNode.shortFrameDuration / 3))
          break
      }
    }
    finally {
      RtNode$.currentNodePriority = outerPriority
    }
  }
}

function launchSetupImpl(node: RtNode$<any>): void {
  if (node.stamp >= 0) { // if not deactivated yet
    if (!node.has(Mode.primitive)) {
      if (node.stamp === Number.MAX_SAFE_INTEGER) {
        Transaction.outside(() => {
          if (RtSystem.isLogging)
            RtSystem.setLoggingHint(node, node.key)
          manageReaction(node.setup).configure({
            order: node.level,
          })
        })
      }
      runNonReactive(node.setup, node.conf.signalArgs) // reactive auto-update
    }
    else if (node.owner !== node)
      runSetupNow(node)
    else // root node
      runTransactional(() => runSetupNow(node))
  }
}

function mountOrRemountIfNecessary(node: RtNode$): void {
  const driver = node.driver
  if (node.stamp === Number.MAX_SAFE_INTEGER) {
    runNonReactive(() => {
      node.stamp = Number.MAX_SAFE_INTEGER - 1 // mark as activated
      driver?.runCreation(node)
      if (!node.has(Mode.external)) {
        node.stamp = 0 // mark as mounted
        if (node.host !== node)
          driver?.runMount(node) // initial mount
      }
    })
  }
  else if (node.isMoved && !node.has(Mode.external) && node.host !== node)
    runNonReactive(() => driver?.runMount(node)) // re-mount
}

function runSetupNow(node: RtNode$<any>): void {
  if (node.stamp >= 0) { // if element is alive
    let result: unknown = undefined
    runInsideContextOfNode(node, () => {
      mountOrRemountIfNecessary(node)
      if (node.stamp < Number.MAX_SAFE_INTEGER - 1) { // if mounted
        try {
          node.stamp++
          node.sequencer = 0
          node.children.beginRenovation()
          result = node.driver.runSetup(node)
          result = proceedSyncOrAsync(result,
            v => { launchNestedNodesThenDoImpl(node, undefined, NOP); return v },
            e => { console.log(e); launchNestedNodesThenDoImpl(node, e ?? new Error("unknown error"), NOP) })
        }
        catch (e: unknown) {
          launchNestedNodesThenDoImpl(node, e, NOP)
          console.log(`Reactive node setup failed: ${node.key}`)
          console.log(`${e}`)
        }
      }
    })
  }
}

function launchDestructionImpl(node: RtNode$, isLeader: boolean, individual: boolean): void {
  if (node.stamp >= 0) {
    const driver = node.driver
    if (individual && node.key !== node.conf.key && !driver?.isPartition)
      console.log(`WARNING: it is recommended to assign explicit key for conditional element in order to avoid unexpected side effects: ${node.key}`)
    node.stamp = ~node.stamp
    // Destroy element itself and remove it from collection
    const childrenAreLeaders = runNonReactive(() => driver?.runDestruction(node, isLeader))
    if (!node.has(Mode.primitive)) {
      // Defer disposal if element is reactive (having non-primitive mode)
      LinkedItem.link$(gDisposeList, node, undefined)
      if (gDisposeList.first === node)
        runTransactional({ isolation: Isolation.disjoinForInternalDisposal, hint: `runDisposalLoop(initiator=${node.key})` }, () => {
          void runDisposalLoop().then(NOP, error => console.log(error))
        })
    }
    // Destroy children
    for (const child of node.children.items())
      launchDestructionImpl(child as RtNode$, childrenAreLeaders ?? false, false)
    RtNode$.grandNodeCount--
  }
}

async function runDisposalLoop(): Promise<void> {
  await Transaction.requestNextFrame()
  let node = gDisposeList.first
  while (node !== undefined) {
    if (Transaction.isFrameOver(500, 5))
      await Transaction.requestNextFrame()
    disposeRxObject(node)
    LinkedItem.link$(undefined, node, undefined)
    node = gDisposeList.first
    RtNode$.disposableNodeCount--
  }
  // console.log(`Element count: ${RtNode$.grandNodeCount} totally (${RtNode$.disposableNodeCount} disposable)`)
  // gFirstToDispose = gLastToDispose = undefined // reset loop
}

function wrapToRunInside<T>(func: (...args: any[]) => T): (...args: any[]) => T {
  let wrappedToRunInside: (...args: any[]) => T
  const outer = gCurrentNode
  if (outer)
    wrappedToRunInside = (...args: any[]): T => {
      return runInsideContextOfNode(outer, func, ...args)
    }
  else
    wrappedToRunInside = func
  return wrappedToRunInside
}

function runInsideContextOfNode<T>(
  node: RtNode$ | undefined,
  func: (...args: any[]) => T,
  ...args: any[]): T {

  const outer = gCurrentNode
  try {
    gCurrentNode = node
    return func(...args)
  }
  finally {
    gCurrentNode = outer
  }
}

export function signalsAreEqual(a1: any, a2: any): boolean {
  let result = a1 === a2
  if (!result) {
    if (Array.isArray(a1)) {
      result = Array.isArray(a2) &&
        a1.length === a2.length &&
        a1.every((t, i) => t === a2[i])
    }
    else if (a1 === Object(a1) && a2 === Object(a2)) {
      for (const p in a1) {
        result = a1[p] === a2[p]
        if (!result)
          break
      }
    }
  }
  return result
}

function push<T>(item: T, array: Array<T> | undefined): Array<T> {
  if (array == undefined)
    array = new Array<T>()
  array.push(item)
  return array
}

function shuffle<T>(array: Array<T>): Array<T> {
  const n = array.length - 1
  let i = n
  while (i >= 0) {
    const j = Math.floor(Math.random() * n)
    const t = array[i]
    array[i] = array[j]
    array[j] = t
    i--
  }
  return array
}

// Seamless support for asynchronous programming

const ORIGINAL_PROMISE_THEN = Promise.prototype.then

function reactronicDomHookedThen(this: any,
  resolve?: ((value: any) => any | PromiseLike<any>) | undefined | null,
  reject?: ((reason: any) => never | PromiseLike<never>) | undefined | null): Promise<any | never> {
  resolve = resolve ? wrapToRunInside(resolve) : defaultResolve
  reject = reject ? wrapToRunInside(reject) : defaultReject
  return ORIGINAL_PROMISE_THEN.call(this, resolve, reject)
}

function defaultResolve(value: any): any {
  return value
}

function defaultReject(error: any): never {
  throw error
}

Promise.prototype.then = reactronicDomHookedThen

// Globals

const NOP: any = (...args: any[]): void => { /* nop */ }
const NOP_ASYNC: any = async (...args: any[]): Promise<void> => { /* nop */ }

let gCurrentNode: RtNode$ | undefined = undefined
const gDisposeList: LinkedSubList<RtNode> = new LinkedSubList()
