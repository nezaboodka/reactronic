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
import { ReactiveSystem, options, signal, reaction, runTransactional, runNonReactive, manageReaction, disposeRxObject } from "../System.js"

// Script, ScriptTask, Handler

export type Script<E> = (this: E, o: E, basis: () => void) => void
export type ScriptTask<E> = (this: E, o: E, basis: () => Promise<void>) => Promise<void>
export type Handler<E = unknown, R = void> = (o: E) => R
export type Producer<E> = (description?: ReactiveTreeNodeDesc<E>) => ReactiveTreeNode<E>

// ProducerApi

export type ProducerApi<E> = {
  ( setup: Script<E>,
    setupTask?: ScriptTask<E> | undefined,
    basis?: ReactiveTreeNodeDesc<E> | undefined): ReactiveTreeNode<E>

  ( key: string,
    setup: Script<E>,
    setupTask?: ScriptTask<E> | undefined,
    basis?: ReactiveTreeNodeDesc<E> | undefined): ReactiveTreeNode<E>

  ( mode: Mode,
    setup: Script<E>,
    setupTask?: ScriptTask<E> | undefined,
    basis?: ReactiveTreeNodeDesc<E> | undefined): ReactiveTreeNode<E>

  ( key: string,
    mode: Mode,
    setup: Script<E>,
    setupTask?: ScriptTask<E> | undefined,
    basis?: ReactiveTreeNodeDesc<E> | undefined): ReactiveTreeNode<E>

  ( description?: ReactiveTreeNodeDesc<E> | undefined,
    basis?: ReactiveTreeNodeDesc<E> | undefined): ReactiveTreeNode<E>
}

// UsageApiGateway (internal)

type UsageApiGateway<E> = (
  p1?: Script<E> | string | Mode | ReactiveTreeNodeDesc<E>,
  p2?: Script<E> | ScriptTask<E> | Mode | ReactiveTreeNodeDesc<E>,
  p3?: Script<E> | ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p4?: ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p5?: ReactiveTreeNodeDesc<E>) => ReactiveTreeNode<E>

// launchReactiveTree

export function launchReactiveTree<T>(func: (...args: any[]) => T, ...args: any[]): T {
  return Transaction.isolate<T>(runInsideContextOfNode, undefined, func, ...args)
}

// introduce

export function producer<E = void>(impl: Producer<E>): ProducerApi<E> {
  const result: UsageApiGateway<E> =
    function gateway(p1, p2, p3, p4, p5) {
      return impl(args2desc(impl.name, p1, p2, p3, p4, p5))
    }
  return result
}

// produce

export function produce<E = void>(
  caller: string,
  driver: ReactiveTreeNodeDriver<E>,
  p1?: Script<E> | string | Mode | ReactiveTreeNodeDesc<E>,
  p2?: Script<E> | ScriptTask<E> | Mode | ReactiveTreeNodeDesc<E>,
  p3?: Script<E> | ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p4?: ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p5?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E> {
  //
  const owner = gCurrentNode
  const desc: ReactiveTreeNodeDesc<E> = args2desc(caller, p1, p2, p3, p4, p5) ?? { }
  if (desc.caller !== undefined)
    caller = desc.caller
  let key = desc.key
  let result: ReactiveTreeNode$<E>
  if (owner) {
    let existing = owner.driver.produceChild(owner, driver, desc, desc.basis)
    // Reuse existing node or produce a new one
    const renovation = owner.children.renovation
    existing ??= renovation.tryReaffirm(
      key = key || generateKey(caller, owner), undefined,
      "nested elements can be produced inside 'setup' only")
    if (existing) {
      // Reuse existing node
      result = existing as ReactiveTreeNode$<E>
      if (result.driver !== driver && driver !== undefined)
        throw misuse(`changing element driver is not yet supported: "${result.driver.id}" -> "${driver?.id}"`)
      const exSignalArgs = result.description.signalArgs
      if (signalsAreEqual(desc.signalArgs, exSignalArgs))
        desc.signalArgs = exSignalArgs // preserve signal args instance
      result.description = desc
    }
    else {
      // Create new node
      result = new ReactiveTreeNode$<E>(key || generateKey(caller, owner), driver, desc, owner)
      renovation.thisIsAdded(result as ReactiveTreeNode$<unknown>) as ReactiveTreeNode$<E>
    }
  }
  else {
    // Create new root node
    result = new ReactiveTreeNode$(key || generateKey(caller, owner), driver, desc, owner)
    ReactiveTreeNode.launchSetup(result, desc.signalArgs)
  }
  return result
}

// args2desc

export function args2desc<E = void>(
  caller: string,
  p1?: Script<E> | string | Mode | ReactiveTreeNodeDesc<E>,
  p2?: Script<E> | ScriptTask<E> | Mode | ReactiveTreeNodeDesc<E>,
  p3?: Script<E> | ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p4?: ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p5?: ReactiveTreeNodeDesc<E>): ReactiveTreeNodeDesc<E> | undefined {
  //
  let result: ReactiveTreeNodeDesc<E> | undefined
  const t1 = typeof(p1)
  if (t1 === "function")
    result = { caller, setup: p1 as Script<E>, setupTask: p2 as ScriptTask<E>, basis: p3 as ReactiveTreeNodeDesc<E> }
  else if (t1 === "string" && typeof(p2) !== "number")
    result = { caller, key: p1 as string, setup: p2 as Script<E>, setupTask: p3 as ScriptTask<E>, basis: p4 as ReactiveTreeNodeDesc<E> }
  else if (t1 === "string")
    result = { caller, key: p1 as string, mode: p2 as Mode, setup: p3 as Script<E>, setupTask: p4 as ScriptTask<E>, basis: p5 }
  else if (t1 === "number")
    result = { caller, mode: p1 as Mode, setup: p2 as Script<E>, setupTask: p3 as ScriptTask<E>, basis: p4 as ReactiveTreeNodeDesc<E> }
  else if (t1 === "object" && p1 !== null) {
    result = p1 as ReactiveTreeNodeDesc<E>
    result.caller ??= caller
    if (p2 !== undefined)
      result.basis = p2 as ReactiveTreeNodeDesc<E>
  }
  else if (p1 !== undefined)
    throw misuse(`wrong type of the first parameter: ${t1}`)
  else
    result = p2 !== undefined ? { caller, basis: p2 as ReactiveTreeNodeDesc<E> } : undefined
  return result
}

// ReactiveTreeNode

export abstract class ReactiveTreeNode<E = unknown> extends LinkedItem<ReactiveTreeNode<E>> {
  static readonly shortFrameDuration = 16 // ms
  static readonly longFrameDuration = 300 // ms
  static frameDuration = ReactiveTreeNode.longFrameDuration
  static currentNodePriority = Priority.realtime

  abstract readonly key: string
  abstract readonly driver: ReactiveTreeNodeDriver<E>
  abstract readonly description: Readonly<ReactiveTreeNodeDesc<E>/* | ReactiveTreeNodeDescAsync<E>*/>
  abstract readonly level: number
  abstract readonly owner: ReactiveTreeNode
  abstract element: E
  abstract readonly host: ReactiveTreeNode
  abstract readonly children: LinkedList<ReactiveTreeNode>
  abstract readonly stamp: number
  abstract readonly outer: ReactiveTreeNode
  abstract readonly context: ReactiveTreeNodeContext | undefined
  abstract priority?: Priority
  abstract childrenShuffling: boolean
  abstract strictOrder: boolean
  abstract getUri(relativeTo?: ReactiveTreeNode<any>): string
  abstract has(mode: Mode): boolean
  abstract hasAny(mode: Mode): boolean
  abstract configureReactivity(options: Partial<ReactivityOptions>): ReactivityOptions

  static get current(): ReactiveTreeNode {
    return ReactiveTreeNode$.node
  }

  static get isInitialSetup(): boolean {
    return ReactiveTreeNode.current.stamp === 1
  }

  static launchSetup(node: ReactiveTreeNode<any>, signalArgs: unknown): void {
    const impl = node as ReactiveTreeNode$<any>
    const desc = impl.description
    if (node.stamp >= Number.MAX_SAFE_INTEGER || !signalsAreEqual(signalArgs, desc.signalArgs)) {
      desc.signalArgs = signalArgs // remember new signalArgs
      launchSetupImpl(impl)
    }
  }

  static launchDestruction(node: ReactiveTreeNode<any>): void {
    const impl = node as ReactiveTreeNode$<any>
    launchDestructionImpl(impl, true, true)
  }

  static launchNestedNodesThenDo(action: (error: unknown) => void): void {
    launchNestedNodesThenDoImpl(ReactiveTreeNode$.node, undefined, action)
  }

  static markAsMounted(node: ReactiveTreeNode<any>, yes: boolean): void {
    const n = node as ReactiveTreeNode$<any>
    if (n.stamp < 0)
      throw misuse("deactivated node cannot be mounted or unmounted")
    if (n.stamp >= Number.MAX_SAFE_INTEGER)
      throw misuse("node must be activated before mounting")
    n.stamp = yes ? 0 : Number.MAX_SAFE_INTEGER - 1
  }

  lookupTreeNodeByUri<E = unknown>(uri: string): ReactiveTreeNode<E> | undefined {
    const t = Uri.parse(uri)
    if (t.authority !== this.key)
      throw misuse(`authority '${t.authority}' doesn't match root node key '${this.key}'`)
    const segments = t.path.split("/")
    let result = this as ReactiveTreeNode<any>
    for (let i = 1; i < segments.length && result !== undefined; i++)
      result = result.children.lookup(segments[i]) as ReactiveTreeNode<E>
    return result
  }

  static findMatchingHost<E = unknown, R = unknown>(
    node: ReactiveTreeNode<E>, match: Handler<ReactiveTreeNode<E>, boolean>): ReactiveTreeNode<R> | undefined {
    let p = node.host as ReactiveTreeNode<any>
    while (p !== p.host && !match(p))
      p = p.host
    return p
  }

  static findMatchingPrevSibling<E = unknown, R = unknown>(
    node: ReactiveTreeNode<E>, match: Handler<ReactiveTreeNode<E>, boolean>): ReactiveTreeNode<R> | undefined {
    let p = node.prev
    while (p && !match(p))
      p = p.prev
    return p as ReactiveTreeNode<R> | undefined
  }

  static forEachChildRecursively<E = unknown>(
    node: ReactiveTreeNode<E>, action: Handler<ReactiveTreeNode<E>>): void {
    action(node)
    for (const child of node.children.items())
      ReactiveTreeNode.forEachChildRecursively<E>(child as ReactiveTreeNode<any>, action)
  }

  static getDefaultLoggingOptions(): LoggingOptions | undefined {
    return ReactiveTreeNode$.logging
  }

  static setDefaultLoggingOptions(logging?: LoggingOptions): void {
    ReactiveTreeNode$.logging = logging
  }
}

// ReactiveTreeNodeDesc

export type ReactiveTreeNodeDesc<E = unknown> = {
  caller?: string                  // вызывающий
  key?: string                     // ключ
  mode?: Mode                      // режим
  setup?: Script<E>                // настройка
  setupTask?: ScriptTask<E>        // настройка-задача
  creation?: Script<E>             // создание
  creationTask?: ScriptTask<E>     // создание-задача
  mounting?: Script<E>,            // монтаж
  destruction?: Script<E>          // уничтожение
  signalArgs?: unknown             // аргументы-сигналы
  unmounted?: boolean,             // размонтировано
  basis?: ReactiveTreeNodeDesc<E>  // базис
}

// ReactiveTreeNodeDriver

export type ReactiveTreeNodeDriver<E = unknown> = {
  readonly id: string,
  readonly isPartition: boolean,
  readonly initialize?: Handler<E>

  create(node: ReactiveTreeNode<E>): E

  runCreation(node: ReactiveTreeNode<E>): void

  runDestruction(node: ReactiveTreeNode<E>, isLeader: boolean): boolean

  runMount(node: ReactiveTreeNode<E>): void

  runSetup(node: ReactiveTreeNode<E>): void | Promise<void>

  produceChild(ownerNode: ReactiveTreeNode<E>,
    childDriver: ReactiveTreeNodeDriver<any>,
    childDescription?: ReactiveTreeNodeDesc<any>,
    childBasis?: ReactiveTreeNodeDesc<any>): LinkedItem<ReactiveTreeNode> | undefined

  provideHost(node: ReactiveTreeNode<E>): ReactiveTreeNode<E>
}

// ReactiveTreeNodeContext

export type ReactiveTreeNodeContext<T extends Object = Object> = {
  variable: ReactiveTreeVariable<T>
  value: T
}

// BaseDriver

export abstract class BaseDriver<E = unknown> implements ReactiveTreeNodeDriver<E> {
  constructor(
    readonly id: string,
    readonly isPartition: boolean,
    readonly initialize?: Handler<E>) {
  }

  abstract create(node: ReactiveTreeNode<E>): E

  runCreation(node: ReactiveTreeNode<E>): void | Promise<void> {
    this.initialize?.(node.element)
    return invokeCreationUsingBasisChain(node.element, node.description)
  }

  runDestruction(node: ReactiveTreeNode<E>, isLeader: boolean): boolean {
    invokeDestructionUsingBasisChain(node.element, node.description)
    return isLeader // treat children as deactivation leaders as well
  }

  runMount(node: ReactiveTreeNode<E>): void {
    invokeMountingUsingBasisChain(node.element, node.description)
  }

  runSetup(node: ReactiveTreeNode<E>): void | Promise<void> {
    return invokeSetupUsingBasisChain(node.element, node.description)
  }

  produceChild(ownerNode: ReactiveTreeNode<E>,
    childDriver: ReactiveTreeNodeDriver<any>,
    childDescription?: ReactiveTreeNodeDesc<any>,
    childBasis?: ReactiveTreeNodeDesc<any>): LinkedItem<ReactiveTreeNode> | undefined {
    return undefined
  }

  provideHost(node: ReactiveTreeNode<E>): ReactiveTreeNode<E> {
    return node
  }
}

// ReactiveTreeVariable

export class ReactiveTreeVariable<T extends Object = Object> {
  readonly hint: string
  readonly defaultValue: T | undefined

  constructor(hint: string, defaultValue?: T) {
    this.hint = hint
    this.defaultValue = defaultValue
  }

  set value(value: T) {
    ReactiveTreeNode$.setTreeVariableValue(this, value)
  }

  get value(): T {
    return ReactiveTreeNode$.useTreeVariableValue(this)
  }

  get valueOrUndefined(): T | undefined {
    return ReactiveTreeNode$.tryUseTreeVariableValue(this)
  }
}

// Utils

export function generateKey(caller: string, owner?: ReactiveTreeNode$): string {
  const n = owner !== undefined ? owner.sequencer++ : 0
  const lettered = emitLetters(n)
  let result: string
  if (ReactiveSystem.isLogging)
    result = `·${caller}·${getCallerInfo(lettered)}`
  else
    result = `·${caller}·${lettered}`
  return result
}

export function getModeUsingBasisChain(description?: ReactiveTreeNodeDesc<any>): Mode {
  return description?.mode ?? (description?.basis ? getModeUsingBasisChain(description?.basis) : Mode.default)
}

function invokeSetupUsingBasisChain(element: unknown, description: ReactiveTreeNodeDesc<any>): void | Promise<void> {
  let result: void | Promise<void> = undefined
  const basis = description.basis
  const setup = description.setup
  const setupTask = description.setupTask
  if (setup && setupTask)
    throw misuse("'setup' and 'setupTask' cannot be defined together")
  if (setup)
    result = setup.call(element, element, basis ? () => invokeSetupUsingBasisChain(element, basis) : NOP)
  else if (setupTask)
    result = setupTask.call(element, element, basis ? () => invokeSetupUsingBasisChain(element, basis) : NOP_ASYNC)
  else if (basis)
    result = invokeSetupUsingBasisChain(element, basis)
  return result
}

function invokeCreationUsingBasisChain(element: unknown, description: ReactiveTreeNodeDesc<any>): void | Promise<void> {
  let result: void | Promise<void> = undefined
  const basis = description.basis
  const creation = description.creation
  const creationTask = description.creationTask
  if (creation && creationTask)
    throw misuse("'creation' and 'creationTask' cannot be defined together")
  if (creation)
    result = creation.call(element, element, basis ? () => invokeCreationUsingBasisChain(element, basis) : NOP)
  else if (creationTask)
    result = creationTask.call(element, element, basis ? () => invokeCreationUsingBasisChain(element, basis) : NOP_ASYNC)
  else if (basis)
    result = invokeCreationUsingBasisChain(element, basis)
  return result
}

function invokeMountingUsingBasisChain(element: unknown, description: ReactiveTreeNodeDesc<any>): void {
  const basis = description.basis
  const mounting = description.mounting
  if (mounting)
    mounting.call(element, element, basis ? () => invokeMountingUsingBasisChain(element, basis) : NOP)
  else if (basis)
    invokeMountingUsingBasisChain(element, basis)
}

function invokeDestructionUsingBasisChain(element: unknown, description: ReactiveTreeNodeDesc<any>): void {
  const basis = description.basis
  const destruction = description.destruction
  if (destruction)
    destruction.call(element, element, basis ? () => invokeDestructionUsingBasisChain(element, basis) : NOP)
  else if (basis)
    invokeDestructionUsingBasisChain(element, basis)
}

// ReactiveTreeNodeContext$

class ReactiveTreeNodeContext$<T extends Object = Object> extends RxObject implements ReactiveTreeNodeContext<T> {
  @signal(false) next: ReactiveTreeNodeContext$<object> | undefined
  @signal(false) variable: ReactiveTreeVariable<T>
  value: T

  constructor(variable: ReactiveTreeVariable<T>, value: T) {
    super()
    this.next = undefined
    this.variable = variable
    this.value = value
  }
}

// ReactiveTreeNodeImpl

class ReactiveTreeNode$<E = unknown> extends ReactiveTreeNode<E> {
  static logging: LoggingOptions | undefined = undefined
  static grandNodeCount: number = 0
  static disposableNodeCount: number = 0

  readonly key: string
  readonly driver: ReactiveTreeNodeDriver<E>
  description: ReactiveTreeNodeDesc<E>
  readonly level: number
  readonly owner: ReactiveTreeNode$
  readonly element: E
  host: ReactiveTreeNode
  readonly children: LinkedList<ReactiveTreeNode>
  stamp: number
  outer: ReactiveTreeNode$
  context: ReactiveTreeNodeContext$<any> | undefined
  sequencer: number
  priority: Priority
  childrenShuffling: boolean

  constructor(
    key: string, driver: ReactiveTreeNodeDriver<E>,
    description: Readonly<ReactiveTreeNodeDesc<E>>,
    owner: ReactiveTreeNode$ | undefined) {
    super()
    const thisAsUnknown = this as ReactiveTreeNode$<unknown>
    this.key = key
    this.driver = driver
    this.description = description
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
    this.children = new LinkedList<ReactiveTreeNode>(getNodeKey, true)
    this.stamp = Number.MAX_SAFE_INTEGER // newly created
    this.context = undefined
    this.sequencer = 0
    this.priority = Priority.realtime
    this.childrenShuffling = false
    // Monitoring
    ReactiveTreeNode$.grandNodeCount++
    if (!this.has(Mode.primitive))
      ReactiveTreeNode$.disposableNodeCount++
  }

  getUri(relativeTo?: ReactiveTreeNode<any>): string {
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
    return flags(getModeUsingBasisChain(this.description), mode)
  }

  hasAny(mode: Mode): boolean {
    return flagsAny(getModeUsingBasisChain(this.description), mode)
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

  static get node(): ReactiveTreeNode$ {
    if (!gCurrentNode)
      throw misuse("current node is undefined")
    return gCurrentNode
  }

  static tryUseTreeVariableValue<T extends Object>(variable: ReactiveTreeVariable<T>): T | undefined {
    let node = ReactiveTreeNode.current
    while (node.context?.variable !== variable && node.owner !== node)
      node = node.outer
    const ctx = node.context as ReactiveTreeNodeContext<T>
    return ctx?.variable === variable ? ctx.value : undefined
  }

  static useTreeVariableValue<T extends Object>(variable: ReactiveTreeVariable<T>): T {
    const result = ReactiveTreeNode$.tryUseTreeVariableValue(variable) ?? variable.defaultValue
    if (!result)
      throw misuse("unknown node variable")
    return result
  }

  static setTreeVariableValue<T extends Object>(variable: ReactiveTreeVariable<T>, value: T | undefined): void {
    const node = ReactiveTreeNode$.node
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
          node.context = new ReactiveTreeNodeContext$<any>(variable, value)
      })
    }
    else if (hostCtx)
      node.outer = owner
    else
      node.outer = owner.outer
  }
}

// Internal

function gatherAuthorityAndPath<T>(node: ReactiveTreeNode<T>, path: Array<string>, relativeTo?: ReactiveTreeNode<any>): string {
  let authority: string
  if (node.owner !== node && node.owner !== relativeTo) {
    authority = gatherAuthorityAndPath(node.owner, path)
    path.push(node.key)
  }
  else
    authority = node.key
  return authority
}

function getNodeKey(node: ReactiveTreeNode): string | undefined {
  return node.stamp >= 0 ? node.key : undefined
}

function launchNestedNodesThenDoImpl(node: ReactiveTreeNode$<any>, error: unknown, action: (error: unknown) => void): void {
  runInsideContextOfNode(node, () => {
    const owner = node
    const children = owner.children
    if (children.isRenovationInProgress) {
      let promised: Promise<void> | undefined = undefined
      try {
        const renovation = children.endRenovation(error)
        // Deactivate removed elements
        for (const child of renovation.lostItems())
          launchDestructionImpl(child as ReactiveTreeNode$, true, true)
        if (!error) {
          // Lay out and update actual elements
          const sequential = children.isStrictOrder
          let p1: Array<ReactiveTreeNode$> | undefined = undefined
          let p2: Array<ReactiveTreeNode$> | undefined = undefined
          let mounting = false
          let partition = owner
          for (const c of children.items()) {
            if (Transaction.isCanceled)
              break
            const child = c as ReactiveTreeNode$
            const isPartition = child.driver.isPartition
            const host = isPartition ? owner : partition
            mounting = markToMountIfNecessary(
              mounting, host, child, children, sequential)
            const p = child.priority ?? Priority.realtime
            if (p === Priority.realtime)
              launchSetupImpl(child as ReactiveTreeNode$) // synchronously
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

function markToMountIfNecessary(mounting: boolean, host: ReactiveTreeNode,
  node: ReactiveTreeNode$, children: LinkedList<ReactiveTreeNode>, sequential: boolean): boolean {
  // Detects element mounting when artificial elements
  // exist among regular elements having native HTML elements
  if (node.description.unmounted)
    host = node
  if (!node.hasAny(Mode.fragment | Mode.external)) {
    if (mounting || node.host !== host) {
      LinkedItem.setStatus$(node as ReactiveTreeNode, Mark.moved, node.rank)
      mounting = false
    }
  }
  else if (sequential && node.mark === Mark.moved)
    mounting = true // apply to the first element having native HTML element
  node.host = host
  return mounting
}

async function startIncrementalNestedScriptsRun(
  ownerNode: ReactiveTreeNode$,
  allChildren: LinkedList<ReactiveTreeNode>,
  priority1?: Array<ReactiveTreeNode$>,
  priority2?: Array<ReactiveTreeNode$>): Promise<void> {
  const stamp = ownerNode.stamp
  if (priority1)
    await runNestedScriptsIncrementally(ownerNode, stamp, allChildren, priority1, Priority.normal)
  if (priority2)
    await runNestedScriptsIncrementally(ownerNode, stamp, allChildren, priority2, Priority.background)
}

async function runNestedScriptsIncrementally(owner: ReactiveTreeNode$, stamp: number,
  allChildren: LinkedList<ReactiveTreeNode>, items: Array<ReactiveTreeNode$>,
  priority: Priority): Promise<void> {
  await Transaction.requestNextFrame()
  const node = owner
  if (!Transaction.isCanceled || !Transaction.isFrameOver(1, ReactiveTreeNode$.shortFrameDuration / 3)) {
    let outerPriority = ReactiveTreeNode$.currentNodePriority
    ReactiveTreeNode$.currentNodePriority = priority
    try {
      if (node.childrenShuffling)
        shuffle(items)
      const frameDurationLimit = priority === Priority.background ? ReactiveTreeNode.shortFrameDuration : Infinity
      let frameDuration = Math.min(frameDurationLimit, Math.max(ReactiveTreeNode.frameDuration / 4, ReactiveTreeNode.shortFrameDuration))
      for (const child of items) {
        launchSetupImpl(child)
        if (Transaction.isFrameOver(1, frameDuration)) {
          ReactiveTreeNode$.currentNodePriority = outerPriority
          await Transaction.requestNextFrame(0)
          outerPriority = ReactiveTreeNode$.currentNodePriority
          ReactiveTreeNode$.currentNodePriority = priority
          frameDuration = Math.min(4 * frameDuration, Math.min(frameDurationLimit, ReactiveTreeNode.frameDuration))
        }
        if (Transaction.isCanceled && Transaction.isFrameOver(1, ReactiveTreeNode.shortFrameDuration / 3))
          break
      }
    }
    finally {
      ReactiveTreeNode$.currentNodePriority = outerPriority
    }
  }
}

function launchSetupImpl(node: ReactiveTreeNode$<any>): void {
  if (node.stamp >= 0) { // if not deactivated yet
    if (!node.has(Mode.primitive)) {
      if (node.stamp === Number.MAX_SAFE_INTEGER) {
        Transaction.outside(() => {
          if (ReactiveSystem.isLogging)
            ReactiveSystem.setLoggingHint(node, node.key)
          manageReaction(node.setup).configure({
            order: node.level,
          })
        })
      }
      runNonReactive(node.setup, node.description.signalArgs) // reactive auto-update
    }
    else if (node.owner !== node)
      runSetupNow(node)
    else // root node
      runTransactional(() => runSetupNow(node))
  }
}

function mountOrRemountIfNecessary(node: ReactiveTreeNode$): void {
  const driver = node.driver
  if (node.stamp === Number.MAX_SAFE_INTEGER) {
    runNonReactive(() => {
      node.stamp = Number.MAX_SAFE_INTEGER - 1 // mark as activated
      driver.runCreation(node)
      if (!node.has(Mode.external)) {
        node.stamp = 0 // mark as mounted
        if (node.host !== node)
          driver.runMount(node) // initial mount
      }
    })
  }
  else if (node.isMoved && !node.has(Mode.external) && node.host !== node)
    runNonReactive(() => driver.runMount(node)) // re-mount
}

function runSetupNow(node: ReactiveTreeNode$<any>): void {
  if (node.stamp >= 0) { // if element is alive
    let result: unknown = undefined
    runInsideContextOfNode(node, () => {
      mountOrRemountIfNecessary(node)
      if (node.stamp < Number.MAX_SAFE_INTEGER - 1) { // if mounted
        try {
          node.stamp++
          node.sequencer = 0
          node.children.beginRenovation()
          const driver = node.driver
          result = driver.runSetup(node)
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

function launchDestructionImpl(node: ReactiveTreeNode$, isLeader: boolean, individual: boolean): void {
  if (node.stamp >= 0) {
    const driver = node.driver
    if (individual && node.key !== node.description.key && !driver.isPartition)
      console.log(`WARNING: it is recommended to assign explicit key for conditional element in order to avoid unexpected side effects: ${node.key}`)
    node.stamp = ~node.stamp
    // Destroy element itself and remove it from collection
    const childrenAreLeaders = runNonReactive(() => driver.runDestruction(node, isLeader))
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
      launchDestructionImpl(child as ReactiveTreeNode$, childrenAreLeaders, false)
    ReactiveTreeNode$.grandNodeCount--
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
    ReactiveTreeNode$.disposableNodeCount--
  }
  // console.log(`Element count: ${ReactiveTreeNodeImpl.grandNodeCount} totally (${ReactiveTreeNodeImpl.disposableNodeCount} disposable)`)
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
  node: ReactiveTreeNode$ | undefined,
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

let gCurrentNode: ReactiveTreeNode$ | undefined = undefined
const gDisposeList: LinkedSubList<ReactiveTreeNode> = new LinkedSubList()
