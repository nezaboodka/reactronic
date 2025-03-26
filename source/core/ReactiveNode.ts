// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2025 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "../util/Dbg.js"
import { LoggingOptions } from "../Logging.js"
import { MergeList, MergeListReader, MergedItem } from "../util/MergeList.js"
import { emitLetters, getCallerInfo, proceedSyncOrAsync } from "../util/Utils.js"
import { Isolation, MemberOptions, Reentrance } from "../Options.js"
import { TriggeringObject } from "../core/Mvcc.js"
import { Transaction } from "../core/Transaction.js"
import { ReactiveSystem, options, trigger, reactive, atomicRun, nonReactiveRun } from "../ReactiveSystem.js"

// Scripts

export type Script<E> = (el: E, basis: () => void) => void
export type ScriptAsync<E> = (el: E, basis: () => Promise<void>) => Promise<void>
export type Handler<E = unknown, R = void> = (el: E) => R

// Enums

export enum Mode {
  default = 0,
  autonomous = 1,
  manualMount = 2,
  rootNode = 4,
}

export enum Priority {
  realtime = 0,
  normal = 1,
  background = 2
}

// ReactiveNode

export abstract class ReactiveNode<E = unknown> {
  abstract readonly key: string
  abstract readonly driver: ReactiveNodeDriver<E>
  abstract readonly declaration: Readonly<ReactiveNodeDecl<E>/* | ReactiveNodeDeclAsync<E>*/>
  abstract readonly level: number
  abstract readonly owner: ReactiveNode
  abstract element: E
  abstract readonly host: ReactiveNode
  abstract readonly children: MergeListReader<ReactiveNode>
  abstract readonly slot: MergedItem<ReactiveNode<E>> | undefined
  abstract readonly stamp: number
  abstract readonly outer: ReactiveNode
  abstract readonly context: ReactiveNodeContext | undefined
  abstract priority?: Priority
  abstract childrenShuffling: boolean
  abstract strictOrder: boolean
  abstract has(mode: Mode): boolean
  abstract configureReactronic(options: Partial<MemberOptions>): MemberOptions

  static readonly shortFrameDuration = 16 // ms
  static readonly longFrameDuration = 300 // ms
  static currentScriptPriority = Priority.realtime
  static frameDuration = ReactiveNode.longFrameDuration

  static declare<E = void>(
    driver: ReactiveNodeDriver<E>,
    script?: Script<E>,
    scriptAsync?: ScriptAsync<E>,
    key?: string,
    mode?: Mode,
    preparation?: Script<E>,
    preparationAsync?: ScriptAsync<E>,
    finalization?: Script<E>,
    triggers?: unknown,
    basis?: ReactiveNodeDecl<E>): ReactiveNode<E>

  static declare<E = void>(
    driver: ReactiveNodeDriver<E>,
    declaration?: ReactiveNodeDecl<E>): ReactiveNode<E>

  static declare<E = void>(
    driver: ReactiveNodeDriver<E>,
    scriptOrDeclaration?: Script<E> | ReactiveNodeDecl<E>,
    scriptAsync?: ScriptAsync<E>,
    key?: string,
    mode?: Mode,
    preparation?: Script<E>,
    preparationAsync?: ScriptAsync<E>,
    finalization?: Script<E>,
    triggers?: unknown,
    basis?: ReactiveNodeDecl<E>):  ReactiveNode<E>

  static declare<E = void>(
    driver: ReactiveNodeDriver<E>,
    scriptOrDeclaration?: Script<E> | ReactiveNodeDecl<E>,
    scriptAsync?: ScriptAsync<E>,
    key?: string,
    mode?: Mode,
    preparation?: Script<E>,
    preparationAsync?: ScriptAsync<E>,
    finalization?: Script<E>,
    triggers?: unknown,
    basis?: ReactiveNodeDecl<E>):  ReactiveNode<E> {
    let result: ReactiveNodeImpl<E>
    let declaration: ReactiveNodeDecl<E>
    // Normalize parameters
    if (scriptOrDeclaration instanceof Function) {
      declaration = {
        script: scriptOrDeclaration, scriptAsync, key, mode,
        preparation, preparationAsync, finalization, triggers, basis,
      }
    }
    else
      declaration = scriptOrDeclaration ?? {}
    let effectiveKey = declaration.key
    const owner = (getModeUsingBasisChain(declaration) & Mode.rootNode) !== Mode.rootNode ? gNodeSlot?.instance : undefined
    if (owner) {
      let existing = owner.driver.declareChild(owner, driver, declaration, declaration.basis)
      // Reuse existing node or declare a new one
      const children = owner.children
      existing ??= children.tryMergeAsExisting(
        effectiveKey = effectiveKey || generateKey(owner), undefined,
        "nested elements can be declared inside 'script' only")
      if (existing) {
        // Reuse existing node
        result = existing.instance as ReactiveNodeImpl<E>
        if (result.driver !== driver && driver !== undefined)
          throw new Error(`changing element driver is not yet supported: "${result.driver.name}" -> "${driver?.name}"`)
        const exTriggers = result.declaration.triggers
        if (triggersAreEqual(declaration.triggers, exTriggers))
          declaration.triggers = exTriggers // preserve triggers instance
        result.declaration = declaration
      }
      else {
        // Create new node
        result = new ReactiveNodeImpl<E>(effectiveKey || generateKey(owner), driver, declaration, owner)
        result.slot = children.mergeAsAdded(result as ReactiveNodeImpl<unknown>) as MergedItem<ReactiveNodeImpl<E>>
      }
    }
    else {
      // Create new root node
      result = new ReactiveNodeImpl(effectiveKey || "", driver, declaration, owner)
      result.slot = MergeList.createItem(result)
      triggerScriptRunViaSlot(result.slot)
    }
    return result
  }

  static withBasis<E = void>(
    declaration?: ReactiveNodeDecl<E>,
    basis?: ReactiveNodeDecl<E>): ReactiveNodeDecl<E> {
    if (declaration)
      declaration.basis = basis
    else
      declaration = basis ?? {}
    return declaration
  }

  static get isFirstScriptRun(): boolean {
    return ReactiveNodeImpl.nodeSlot.instance.stamp === 1
  }

  static get key(): string {
    return ReactiveNodeImpl.nodeSlot.instance.key
  }

  static get stamp(): number {
    return ReactiveNodeImpl.nodeSlot.instance.stamp
  }

  static get triggers(): unknown {
    return ReactiveNodeImpl.nodeSlot.instance.declaration.triggers
  }

  static get priority(): Priority {
    return ReactiveNodeImpl.nodeSlot.instance.priority
  }

  static set priority(value: Priority) {
    ReactiveNodeImpl.nodeSlot.instance.priority = value
  }

  static get childrenShuffling(): boolean {
    return ReactiveNodeImpl.nodeSlot.instance.childrenShuffling
  }

  static set childrenShuffling(value: boolean) {
    ReactiveNodeImpl.nodeSlot.instance.childrenShuffling = value
  }

  static triggerScriptRun(node: ReactiveNode<any>, triggers: unknown): void {
    const impl = node as ReactiveNodeImpl<any>
    const declaration = impl.declaration
    if (!triggersAreEqual(triggers, declaration.triggers)) {
      declaration.triggers = triggers // remember new triggers
      triggerScriptRunViaSlot(impl.slot!)
    }
  }

  static triggerFinalization(node: ReactiveNode<any>): void {
    const impl = node as ReactiveNodeImpl<any>
    triggerFinalization(impl.slot!, true, true)
  }

  static runNestedNodeScriptsThenDo(action: (error: unknown) => void): void {
    runNestedNodeScriptsThenDoImpl(ReactiveNodeImpl.nodeSlot, undefined, action)
  }

  static markAsMounted(node: ReactiveNode<any>, yes: boolean): void {
    const n = node as ReactiveNodeImpl<any>
    if (n.stamp < 0)
      throw new Error("deactivated node cannot be mounted or unmounted")
    if (n.stamp >= Number.MAX_SAFE_INTEGER)
      throw new Error("node must be activated before mounting")
    n.stamp = yes ? 0 : Number.MAX_SAFE_INTEGER - 1
  }

  static findMatchingHost<E = unknown, R = unknown>(
    node: ReactiveNode<E>, match: Handler<ReactiveNode<E>, boolean>): ReactiveNode<R> | undefined {
    let p = node.host as ReactiveNodeImpl<any>
    while (p !== p.host && !match(p))
      p = p.host
    return p
  }

  static findMatchingPrevSibling<E = unknown, R = unknown>(
    node: ReactiveNode<E>, match: Handler<ReactiveNode<E>, boolean>): ReactiveNode<R> | undefined {
    let p = node.slot!.prev
    while (p && !match(p.instance))
      p = p.prev
    return p?.instance as ReactiveNode<R> | undefined
  }

  static forEachChildRecursively<E = unknown>(
    node: ReactiveNode<E>, action: Handler<ReactiveNode<E>>): void {
    action(node)
    for (const child of node.children.items())
      ReactiveNode.forEachChildRecursively<E>(child.instance as ReactiveNode<any>, action)
  }

  static getDefaultLoggingOptions(): LoggingOptions | undefined {
    return ReactiveNodeImpl.logging
  }

  static setDefaultLoggingOptions(logging?: LoggingOptions): void {
    ReactiveNodeImpl.logging = logging
  }
}

// ReactiveNodeDecl

export type ReactiveNodeDecl<E = unknown> = {
  script?: Script<E>                // скрипт
  scriptAsync?: ScriptAsync<E>      // скрипт-асин
  key?: string                      // ключ
  mode?: Mode                       // режим
  preparation?: Script<E>           // подготовка
  preparationAsync?: ScriptAsync<E> // подготовка-асин
  finalization?: Script<E>          // завершение
  triggers?: unknown                // триггеры
  basis?: ReactiveNodeDecl<E>       // базис
}

// ReactiveNodeDriver

export type ReactiveNodeDriver<E = unknown> = {
  readonly name: string,
  readonly isPartition: boolean,
  readonly initialize?: Handler<E>

  create(node: ReactiveNode<E>): E

  runPreparation(node: ReactiveNode<E>): void

  runFinalization(node: ReactiveNode<E>, isLeader: boolean): boolean

  runMount(node: ReactiveNode<E>): void

  runScript(node: ReactiveNode<E>): void | Promise<void>

  declareChild(ownerNode: ReactiveNode<E>,
    childDriver: ReactiveNodeDriver<any>,
    childDeclaration?: ReactiveNodeDecl<any>,
    childBasis?: ReactiveNodeDecl<any>): MergedItem<ReactiveNode> | undefined

  provideHost(node: ReactiveNode<E>): ReactiveNode<E>
}

// ReactiveNodeContext

export type ReactiveNodeContext<T extends Object = Object> = {
  value: T
}

// BaseDriver

export abstract class BaseDriver<E = unknown> implements ReactiveNodeDriver<E> {
  constructor(
    readonly name: string,
    readonly isPartition: boolean,
    readonly initialize?: Handler<E>) {
  }

  abstract create(node: ReactiveNode<E>): E

  runPreparation(node: ReactiveNode<E>): void | Promise<void> {
    this.initialize?.(node.element)
    return invokePreparationUsingBasisChain(node.element, node.declaration)
  }

  runFinalization(node: ReactiveNode<E>, isLeader: boolean): boolean {
    invokeFinalizationUsingBasisChain(node.element, node.declaration)
    return isLeader // treat children as deactivation leaders as well
  }

  runMount(node: ReactiveNode<E>): void {
    // nothing to do by default
  }

  runScript(node: ReactiveNode<E>): void | Promise<void> {
    return invokeScriptUsingBasisChain(node.element, node.declaration)
  }

  declareChild(ownerNode: ReactiveNode<E>,
    childDriver: ReactiveNodeDriver<any>,
    childDeclaration?: ReactiveNodeDecl<any>,
    childBasis?: ReactiveNodeDecl<any>): MergedItem<ReactiveNode> | undefined {
    return undefined
  }

  provideHost(node: ReactiveNode<E>): ReactiveNode<E> {
    return node
  }
}

// ReactiveNodeVariable

export class ReactiveNodeVariable<T extends Object = Object> {
  readonly defaultValue: T | undefined

  constructor(defaultValue?: T) {
    this.defaultValue = defaultValue
  }

  set value(value: T) {
    ReactiveNodeImpl.setNodeVariableValue(this, value)
  }

  get value(): T {
    return ReactiveNodeImpl.useNodeVariableValue(this)
  }

  get valueOrUndefined(): T | undefined {
    return ReactiveNodeImpl.tryUseNodeVariableValue(this)
  }
}

// Utils

function generateKey(owner: ReactiveNodeImpl): string {
  const n = owner.numerator++
  const lettered = emitLetters(n)
  let result: string
  if (ReactiveSystem.isLogging)
    result = `·${getCallerInfo(lettered)}`
  else
    result = `·${lettered}`
  return result
}

function getModeUsingBasisChain(declaration?: ReactiveNodeDecl<any>): Mode {
  return declaration?.mode ?? (declaration?.basis ? getModeUsingBasisChain(declaration?.basis) : Mode.default)
}

function invokeScriptUsingBasisChain(element: unknown, declaration: ReactiveNodeDecl<any>): void | Promise<void> {
  let result: void | Promise<void> = undefined
  const basis = declaration.basis
  const script = declaration.script
  const scriptAsync = declaration.scriptAsync
  if (script && scriptAsync)
    throw misuse("'script' and 'scriptAsync' cannot be defined together")
  if (script)
    result = script(element, basis ? () => invokeScriptUsingBasisChain(element, basis) : NOP)
  else if (scriptAsync)
    result = scriptAsync(element, basis ? () => invokeScriptUsingBasisChain(element, basis) : NOP_ASYNC)
  else if (basis)
    result = invokeScriptUsingBasisChain(element, basis)
  return result
}

function invokePreparationUsingBasisChain(element: unknown, declaration: ReactiveNodeDecl<any>): void | Promise<void> {
  let result: void | Promise<void> = undefined
  const basis = declaration.basis
  const preparation = declaration.preparation
  const preparationAsync = declaration.preparationAsync
  if (preparation && preparationAsync)
    throw misuse("'preparation' and 'preparationAsync' cannot be defined together")
  if (preparation)
    result = preparation(element, basis ? () => invokePreparationUsingBasisChain(element, basis) : NOP)
  else if (preparationAsync)
    result = preparationAsync(element, basis ? () => invokePreparationUsingBasisChain(element, basis) : NOP_ASYNC)
  else if (basis)
    result = invokePreparationUsingBasisChain(element, basis)
  return result
}

function invokeFinalizationUsingBasisChain(element: unknown, declaration: ReactiveNodeDecl<any>): void {
  const basis = declaration.basis
  const finalization = declaration.finalization
  if (finalization)
    finalization(element, basis ? () => invokeFinalizationUsingBasisChain(element, basis) : NOP)
  else if (basis)
    invokeFinalizationUsingBasisChain(element, basis)
}

// ReactiveNodeContextImpl

class ReactiveNodeContextImpl<T extends Object = Object> extends TriggeringObject implements ReactiveNodeContext<T> {
  @trigger(false) next: ReactiveNodeContextImpl<object> | undefined
  @trigger(false) variable: ReactiveNodeVariable<T>
  value: T

  constructor(variable: ReactiveNodeVariable<T>, value: T) {
    super()
    this.next = undefined
    this.variable = variable
    this.value = value
  }
}

// ReactiveNodeImpl

class ReactiveNodeImpl<E = unknown> extends ReactiveNode<E> {
  // Static properties
  static logging: LoggingOptions | undefined = undefined
  static grandNodeCount: number = 0
  static disposableNodeCount: number = 0

  readonly key: string
  readonly driver: ReactiveNodeDriver<E>
  declaration: ReactiveNodeDecl<E>
  readonly level: number
  readonly owner: ReactiveNodeImpl
  readonly element: E
  host: ReactiveNodeImpl
  readonly children: MergeList<ReactiveNodeImpl>
  slot: MergedItem<ReactiveNodeImpl<E>> | undefined
  stamp: number
  outer: ReactiveNodeImpl
  context: ReactiveNodeContextImpl<any> | undefined
  numerator: number
  priority: Priority
  childrenShuffling: boolean

  constructor(
    key: string, driver: ReactiveNodeDriver<E>,
    declaration: Readonly<ReactiveNodeDecl<E>>,
    owner: ReactiveNodeImpl | undefined) {
    super()
    const thisAsUnknown = this as ReactiveNodeImpl<unknown>
    this.key = key
    this.driver = driver
    this.declaration = declaration
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
    this.children = new MergeList<ReactiveNodeImpl>(getNodeKey, true)
    this.slot = undefined
    this.stamp = Number.MAX_SAFE_INTEGER // newly created
    this.context = undefined
    this.numerator = 0
    this.priority = Priority.realtime
    this.childrenShuffling = false
    // Monitoring
    ReactiveNodeImpl.grandNodeCount++
    if (this.has(Mode.autonomous))
      ReactiveNodeImpl.disposableNodeCount++
  }

  get strictOrder(): boolean { return this.children.isStrict }
  set strictOrder(value: boolean) { this.children.isStrict = value }

  get isMoved(): boolean { return this.owner.children.isMoved(this.slot! as MergedItem<ReactiveNodeImpl>) }

  has(mode: Mode): boolean {
    return (getModeUsingBasisChain(this.declaration) & mode) === mode
  }

  @reactive
  @options({
    reentrance: Reentrance.cancelAndWaitPrevious,
    allowObsoleteToFinish: true,
    triggeringArgs: true,
    noSideEffects: false,
  })
  script(_triggers: unknown): void {
    // triggers parameter is used to enforce script run by owner
    runScriptNow(this.slot!)
  }

  configureReactronic(options: Partial<MemberOptions>): MemberOptions {
    if (this.stamp < Number.MAX_SAFE_INTEGER - 1 || !this.has(Mode.autonomous))
      throw new Error("reactronic can be configured only for elements with autonomous mode and only during activation")
    return ReactiveSystem.getOperation(this.script).configure(options)
  }

  static get nodeSlot(): MergedItem<ReactiveNodeImpl> {
    if (!gNodeSlot)
      throw new Error("current element is undefined")
    return gNodeSlot
  }

  static tryUseNodeVariableValue<T extends Object>(variable: ReactiveNodeVariable<T>): T | undefined {
    let node = ReactiveNodeImpl.nodeSlot.instance
    while (node.context?.variable !== variable && node.owner !== node)
      node = node.outer.slot!.instance
    return node.context?.value as any // TODO: to get rid of any
  }

  static useNodeVariableValue<T extends Object>(variable: ReactiveNodeVariable<T>): T {
    const result = ReactiveNodeImpl.tryUseNodeVariableValue(variable) ?? variable.defaultValue
    if (!result)
      throw new Error("unknown node variable")
    return result
  }

  static setNodeVariableValue<T extends Object>(variable: ReactiveNodeVariable<T>, value: T | undefined): void {
    const node = ReactiveNodeImpl.nodeSlot.instance
    const owner = node.owner
    const hostCtx = nonReactiveRun(() => owner.context?.value)
    if (value && value !== hostCtx) {
      if (hostCtx)
        node.outer = owner
      else
        node.outer = owner.outer
      atomicRun({ isolation: Isolation.joinAsNestedTransaction }, () => {
        const ctx = node.context
        if (ctx) {
          ctx.variable = variable
          ctx.value = value // update context thus invalidate reactions
        }
        else
          node.context = new ReactiveNodeContextImpl<any>(variable, value)
      })
    }
    else if (hostCtx)
      node.outer = owner
    else
      node.outer = owner.outer
  }
}

// Internal

function getNodeKey(node: ReactiveNode): string | undefined {
  return node.stamp >= 0 ? node.key : undefined
}

function runNestedNodeScriptsThenDoImpl(nodeSlot: MergedItem<ReactiveNodeImpl<any>>, error: unknown, action: (error: unknown) => void): void {
  runInsideContextOfNode(nodeSlot, () => {
    const owner = nodeSlot.instance
    const children = owner.children
    if (children.isMergeInProgress) {
      let promised: Promise<void> | undefined = undefined
      try {
        children.endMerge(error)
        // Deactivate removed elements
        for (const child of children.removedItems(true))
          triggerFinalization(child, true, true)
        if (!error) {
          // Lay out and update actual elements
          const sequential = children.isStrict
          let p1: Array<MergedItem<ReactiveNodeImpl>> | undefined = undefined
          let p2: Array<MergedItem<ReactiveNodeImpl>> | undefined = undefined
          let mounting = false
          let partition = owner
          for (const child of children.items()) {
            if (Transaction.isCanceled)
              break
            const childNode = child.instance
            const isPart = childNode.driver.isPartition
            const host = isPart ? owner : partition
            mounting = markToMountIfNecessary(
              mounting, host, child, children, sequential)
            const p = childNode.priority ?? Priority.realtime
            if (p === Priority.realtime)
              triggerScriptRunViaSlot(child) // synchronously
            else if (p === Priority.normal)
              p1 = push(child, p1) // defer for P1 async script run
            else
              p2 = push(child, p2) // defer for P2 async script run
            if (isPart)
              partition = childNode
          }
          // Run scripts for incremental children (if any)
          if (!Transaction.isCanceled && (p1 !== undefined || p2 !== undefined))
            promised = startIncrementalNestedScriptsRun(nodeSlot, children, p1, p2).then(
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

function markToMountIfNecessary(mounting: boolean, host: ReactiveNodeImpl,
  nodeSlot: MergedItem<ReactiveNodeImpl>, children: MergeList<ReactiveNodeImpl>, sequential: boolean): boolean {
  // Detects element mounting when abstract elements
  // exist among regular elements having native HTML elements
  const node = nodeSlot.instance
  // TODO: Get rid of "node.element.native"
  if ((node.element as any).native && !node.has(Mode.manualMount)) {
    if (mounting || node.host !== host) {
      children.markAsMoved(nodeSlot)
      mounting = false
    }
  }
  else if (sequential && children.isMoved(nodeSlot))
    mounting = true // apply to the first element having native HTML element
  node.host = host
  return mounting
}

async function startIncrementalNestedScriptsRun(
  ownerSlot: MergedItem<ReactiveNodeImpl>,
  allChildren: MergeList<ReactiveNodeImpl>,
  priority1?: Array<MergedItem<ReactiveNodeImpl>>,
  priority2?: Array<MergedItem<ReactiveNodeImpl>>): Promise<void> {
  const stamp = ownerSlot.instance.stamp
  if (priority1)
    await runNestedScriptsIncrementally(ownerSlot, stamp, allChildren, priority1, Priority.normal)
  if (priority2)
    await runNestedScriptsIncrementally(ownerSlot, stamp, allChildren, priority2, Priority.background)
}

async function runNestedScriptsIncrementally(owner: MergedItem<ReactiveNodeImpl>, stamp: number,
  allChildren: MergeList<ReactiveNodeImpl>, items: Array<MergedItem<ReactiveNodeImpl>>,
  priority: Priority): Promise<void> {
  await Transaction.requestNextFrame()
  const node = owner.instance
  if (!Transaction.isCanceled || !Transaction.isFrameOver(1, ReactiveNode.shortFrameDuration / 3)) {
    let outerPriority = ReactiveNode.currentScriptPriority
    ReactiveNode.currentScriptPriority = priority
    try {
      if (node.childrenShuffling)
        shuffle(items)
      const frameDurationLimit = priority === Priority.background ? ReactiveNode.shortFrameDuration : Infinity
      let frameDuration = Math.min(frameDurationLimit, Math.max(ReactiveNode.frameDuration / 4, ReactiveNode.shortFrameDuration))
      for (const child of items) {
        triggerScriptRunViaSlot(child)
        if (Transaction.isFrameOver(1, frameDuration)) {
          ReactiveNode.currentScriptPriority = outerPriority
          await Transaction.requestNextFrame(0)
          outerPriority = ReactiveNode.currentScriptPriority
          ReactiveNode.currentScriptPriority = priority
          frameDuration = Math.min(4 * frameDuration, Math.min(frameDurationLimit, ReactiveNode.frameDuration))
        }
        if (Transaction.isCanceled && Transaction.isFrameOver(1, ReactiveNode.shortFrameDuration / 3))
          break
      }
    }
    finally {
      ReactiveNode.currentScriptPriority = outerPriority
    }
  }
}

function triggerScriptRunViaSlot(nodeSlot: MergedItem<ReactiveNodeImpl<any>>): void {
  const node = nodeSlot.instance
  if (node.stamp >= 0) { // if not deactivated yet
    if (node.has(Mode.autonomous)) {
      if (node.stamp === Number.MAX_SAFE_INTEGER) {
        Transaction.outside(() => {
          if (ReactiveSystem.isLogging)
            ReactiveSystem.setLoggingHint(node.element, node.key)
          ReactiveSystem.getOperation(node.script).configure({
            order: node.level,
          })
        })
      }
      nonReactiveRun(node.script, node.declaration.triggers) // reactive auto-update
    }
    else if (node.owner !== node)
      runScriptNow(nodeSlot)
    else // root node
      atomicRun(() => runScriptNow(nodeSlot))
  }
}

function mountOrRemountIfNecessary(node: ReactiveNodeImpl): void {
  const driver = node.driver
  if (node.stamp === Number.MAX_SAFE_INTEGER) {
    nonReactiveRun(() => {
      node.stamp = Number.MAX_SAFE_INTEGER - 1 // mark as activated
      driver.runPreparation(node)
      if (!node.has(Mode.manualMount)) {
        node.stamp = 0 // mark as mounted
        if (node.host !== node)
          driver.runMount(node)
      }
    })
  }
  else if (node.isMoved && !node.has(Mode.manualMount) && node.host !== node)
    nonReactiveRun(() => driver.runMount(node))
}

function runScriptNow(nodeSlot: MergedItem<ReactiveNodeImpl<any>>): void {
  const node = nodeSlot.instance
  if (node.stamp >= 0) { // if element is alive
    let result: unknown = undefined
    runInsideContextOfNode(nodeSlot, () => {
      mountOrRemountIfNecessary(node)
      if (node.stamp < Number.MAX_SAFE_INTEGER - 1) { // if mounted
        try {
          node.stamp++
          node.numerator = 0
          node.children.beginMerge()
          const driver = node.driver
          result = driver.runScript(node)
          result = proceedSyncOrAsync(result,
            v => { runNestedNodeScriptsThenDoImpl(nodeSlot, undefined, NOP); return v },
            e => { console.log(e); runNestedNodeScriptsThenDoImpl(nodeSlot, e ?? new Error("unknown error"), NOP) })
        }
        catch (e: unknown) {
          runNestedNodeScriptsThenDoImpl(nodeSlot, e, NOP)
          console.log(`Reactive node script failed: ${node.key}`)
          console.log(`${e}`)
        }
      }
    })
  }
}

function triggerFinalization(nodeSlot: MergedItem<ReactiveNodeImpl>, isLeader: boolean, individual: boolean): void {
  const node = nodeSlot.instance
  if (node.stamp >= 0) {
    const driver = node.driver
    if (individual && node.key !== node.declaration.key && !driver.isPartition)
      console.log(`WARNING: it is recommended to assign explicit key for conditional element in order to avoid unexpected side effects: ${node.key}`)
    node.stamp = ~node.stamp
    // Deactivate element itself and remove it from collection
    const childrenAreLeaders = nonReactiveRun(() => driver.runFinalization(node, isLeader))
    if (node.has(Mode.autonomous)) {
      // Defer disposal if element is reactive (having autonomous mode)
      nodeSlot.aux = undefined
      const last = gLastToDispose
      if (last)
        gLastToDispose = last.aux = nodeSlot
      else
        gFirstToDispose = gLastToDispose = nodeSlot
      if (gFirstToDispose === nodeSlot)
        atomicRun({ isolation: Isolation.disjoinForInternalDisposal, hint: `runDisposalLoop(initiator=${nodeSlot.instance.key})` }, () => {
          void runDisposalLoop().then(NOP, error => console.log(error))
        })
    }
    // Deactivate children
    for (const child of node.children.items())
      triggerFinalization(child, childrenAreLeaders, false)
    ReactiveNodeImpl.grandNodeCount--
  }
}

async function runDisposalLoop(): Promise<void> {
  await Transaction.requestNextFrame()
  let slot = gFirstToDispose
  while (slot !== undefined) {
    if (Transaction.isFrameOver(500, 5))
      await Transaction.requestNextFrame()
    ReactiveSystem.dispose(slot.instance)
    slot = slot.aux
    ReactiveNodeImpl.disposableNodeCount--
  }
  // console.log(`Element count: ${ReactiveNodeImpl.grandNodeCount} totally (${ReactiveNodeImpl.disposableNodeCount} disposable)`)
  gFirstToDispose = gLastToDispose = undefined // reset loop
}

function wrapToRunInside<T>(func: (...args: any[]) => T): (...args: any[]) => T {
  let wrappedToRunInside: (...args: any[]) => T
  const outer = gNodeSlot
  if (outer)
    wrappedToRunInside = (...args: any[]): T => {
      return runInsideContextOfNode(outer, func, ...args)
    }
  else
    wrappedToRunInside = func
  return wrappedToRunInside
}

function runInsideContextOfNode<T>(nodeSlot: MergedItem<ReactiveNodeImpl>, func: (...args: any[]) => T, ...args: any[]): T {
  const outer = gNodeSlot
  try {
    gNodeSlot = nodeSlot
    return func(...args)
  }
  finally {
    gNodeSlot = outer
  }
}

function triggersAreEqual(a1: any, a2: any): boolean {
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

let gNodeSlot: MergedItem<ReactiveNodeImpl> | undefined = undefined
let gFirstToDispose: MergedItem<ReactiveNodeImpl> | undefined = undefined
let gLastToDispose: MergedItem<ReactiveNodeImpl> | undefined = undefined
