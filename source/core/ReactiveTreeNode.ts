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
import { Priority, Mode, Isolation, Reentrance } from "../Enums.js"
import { MemberOptions } from "../Options.js"
import { TriggeringObject } from "../core/Mvcc.js"
import { Transaction } from "../core/Transaction.js"
import { ReactiveSystem, options, trigger, reaction, runAtomically, runNonReactively } from "../ReactiveSystem.js"
import { ReactiveTree } from "./ReactiveTree.js"

// Scripts

export type Script<E> = (el: E, basis: () => void) => void
export type ScriptAsync<E> = (el: E, basis: () => Promise<void>) => Promise<void>
export type Handler<E = unknown, R = void> = (el: E) => R

// ReactiveTreeNode

export abstract class ReactiveTreeNode<E = unknown> {
  abstract readonly key: string
  abstract readonly driver: ReactiveNodeDriver<E>
  abstract readonly declaration: Readonly<ReactiveNodeDecl<E>/* | ReactiveNodeDeclAsync<E>*/>
  abstract readonly level: number
  abstract readonly owner: ReactiveTreeNode
  abstract element: E
  abstract readonly host: ReactiveTreeNode
  abstract readonly children: MergeListReader<ReactiveTreeNode>
  abstract readonly slot: MergedItem<ReactiveTreeNode<E>> | undefined
  abstract readonly stamp: number
  abstract readonly outer: ReactiveTreeNode
  abstract readonly context: ReactiveNodeContext | undefined
  abstract priority?: Priority
  abstract childrenShuffling: boolean
  abstract strictOrder: boolean
  abstract has(mode: Mode): boolean
  abstract configureReactronic(options: Partial<MemberOptions>): MemberOptions
}

// ReactiveNodeDecl

export type ReactiveNodeDecl<E = unknown> = {
  script?: Script<E>                // скрипт
  scriptAsync?: ScriptAsync<E>      // скрипт-задача
  key?: string                      // ключ
  mode?: Mode                       // режим
  preparation?: Script<E>           // подготовка
  preparationAsync?: ScriptAsync<E> // подготовка-задача
  finalization?: Script<E>          // завершение
  triggers?: unknown                // триггеры
  basis?: ReactiveNodeDecl<E>       // базис
}

// ReactiveNodeDriver

export type ReactiveNodeDriver<E = unknown> = {
  readonly name: string,
  readonly isPartition: boolean,
  readonly initialize?: Handler<E>

  create(node: ReactiveTreeNode<E>): E

  runPreparation(node: ReactiveTreeNode<E>): void

  runFinalization(node: ReactiveTreeNode<E>, isLeader: boolean): boolean

  runMount(node: ReactiveTreeNode<E>): void

  runScript(node: ReactiveTreeNode<E>): void | Promise<void>

  declareChild(ownerNode: ReactiveTreeNode<E>,
    childDriver: ReactiveNodeDriver<any>,
    childDeclaration?: ReactiveNodeDecl<any>,
    childBasis?: ReactiveNodeDecl<any>): MergedItem<ReactiveTreeNode> | undefined

  provideHost(node: ReactiveTreeNode<E>): ReactiveTreeNode<E>
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

  abstract create(node: ReactiveTreeNode<E>): E

  runPreparation(node: ReactiveTreeNode<E>): void | Promise<void> {
    this.initialize?.(node.element)
    return invokePreparationUsingBasisChain(node.element, node.declaration)
  }

  runFinalization(node: ReactiveTreeNode<E>, isLeader: boolean): boolean {
    invokeFinalizationUsingBasisChain(node.element, node.declaration)
    return isLeader // treat children as deactivation leaders as well
  }

  runMount(node: ReactiveTreeNode<E>): void {
    // nothing to do by default
  }

  runScript(node: ReactiveTreeNode<E>): void | Promise<void> {
    return invokeScriptUsingBasisChain(node.element, node.declaration)
  }

  declareChild(ownerNode: ReactiveTreeNode<E>,
    childDriver: ReactiveNodeDriver<any>,
    childDeclaration?: ReactiveNodeDecl<any>,
    childBasis?: ReactiveNodeDecl<any>): MergedItem<ReactiveTreeNode> | undefined {
    return undefined
  }

  provideHost(node: ReactiveTreeNode<E>): ReactiveTreeNode<E> {
    return node
  }
}

// ReactiveTreeVariable

export class ReactiveTreeVariable<T extends Object = Object> {
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

export function generateKey(owner: ReactiveNodeImpl): string {
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
  @trigger(false) variable: ReactiveTreeVariable<T>
  value: T

  constructor(variable: ReactiveTreeVariable<T>, value: T) {
    super()
    this.next = undefined
    this.variable = variable
    this.value = value
  }
}

// ReactiveNodeImpl

class ReactiveNodeImpl<E = unknown> extends ReactiveTreeNode<E> {
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

  @reaction
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

  static tryUseNodeVariableValue<T extends Object>(variable: ReactiveTreeVariable<T>): T | undefined {
    let node = ReactiveNodeImpl.nodeSlot.instance
    while (node.context?.variable !== variable && node.owner !== node)
      node = node.outer.slot!.instance
    return node.context?.value as any // TODO: to get rid of any
  }

  static useNodeVariableValue<T extends Object>(variable: ReactiveTreeVariable<T>): T {
    const result = ReactiveNodeImpl.tryUseNodeVariableValue(variable) ?? variable.defaultValue
    if (!result)
      throw new Error("unknown node variable")
    return result
  }

  static setNodeVariableValue<T extends Object>(variable: ReactiveTreeVariable<T>, value: T | undefined): void {
    const node = ReactiveNodeImpl.nodeSlot.instance
    const owner = node.owner
    const hostCtx = runNonReactively(() => owner.context?.value)
    if (value && value !== hostCtx) {
      if (hostCtx)
        node.outer = owner
      else
        node.outer = owner.outer
      runAtomically({ isolation: Isolation.joinAsNestedTransaction }, () => {
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

function getNodeKey(node: ReactiveTreeNode): string | undefined {
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
  if (!Transaction.isCanceled || !Transaction.isFrameOver(1, ReactiveTree.shortFrameDuration / 3)) {
    let outerPriority = ReactiveTree.currentScriptPriority
    ReactiveTree.currentScriptPriority = priority
    try {
      if (node.childrenShuffling)
        shuffle(items)
      const frameDurationLimit = priority === Priority.background ? ReactiveTree.shortFrameDuration : Infinity
      let frameDuration = Math.min(frameDurationLimit, Math.max(ReactiveTree.frameDuration / 4, ReactiveTree.shortFrameDuration))
      for (const child of items) {
        triggerScriptRunViaSlot(child)
        if (Transaction.isFrameOver(1, frameDuration)) {
          ReactiveTree.currentScriptPriority = outerPriority
          await Transaction.requestNextFrame(0)
          outerPriority = ReactiveTree.currentScriptPriority
          ReactiveTree.currentScriptPriority = priority
          frameDuration = Math.min(4 * frameDuration, Math.min(frameDurationLimit, ReactiveTree.frameDuration))
        }
        if (Transaction.isCanceled && Transaction.isFrameOver(1, ReactiveTree.shortFrameDuration / 3))
          break
      }
    }
    finally {
      ReactiveTree.currentScriptPriority = outerPriority
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
      runNonReactively(node.script, node.declaration.triggers) // reactive auto-update
    }
    else if (node.owner !== node)
      runScriptNow(nodeSlot)
    else // root node
      runAtomically(() => runScriptNow(nodeSlot))
  }
}

function mountOrRemountIfNecessary(node: ReactiveNodeImpl): void {
  const driver = node.driver
  if (node.stamp === Number.MAX_SAFE_INTEGER) {
    runNonReactively(() => {
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
    runNonReactively(() => driver.runMount(node))
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
    const childrenAreLeaders = runNonReactively(() => driver.runFinalization(node, isLeader))
    if (node.has(Mode.autonomous)) {
      // Defer disposal if element is reactive (having autonomous mode)
      nodeSlot.aux = undefined
      const last = gLastToDispose
      if (last)
        gLastToDispose = last.aux = nodeSlot
      else
        gFirstToDispose = gLastToDispose = nodeSlot
      if (gFirstToDispose === nodeSlot)
        runAtomically({ isolation: Isolation.disjoinForInternalDisposal, hint: `runDisposalLoop(initiator=${nodeSlot.instance.key})` }, () => {
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

export function triggersAreEqual(a1: any, a2: any): boolean {
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
