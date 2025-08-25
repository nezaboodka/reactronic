// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2025 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "../util/Dbg.js"
import { Uri } from "../util/Uri.js"
import { LoggingOptions } from "../Logging.js"
import { MergeList, MergeListReader, MergedItem } from "../util/MergeList.js"
import { emitLetters, flags, getCallerInfo, proceedSyncOrAsync } from "../util/Utils.js"
import { Priority, Mode, Isolation, Reentrance } from "../Enums.js"
import { ReactivityOptions } from "../Options.js"
import { ObservableObject } from "../core/Mvcc.js"
import { Transaction } from "../core/Transaction.js"
import { ReactiveSystem, options, observable, reactive, runAtomically, runNonReactively, manageReactiveOperation, disposeObservableObject } from "../System.js"

// Scripts

export type Script<E> = (el: E, basis: () => void) => void
export type ScriptAsync<E> = (el: E, basis: () => Promise<void>) => Promise<void>
export type Handler<E = unknown, R = void> = (el: E) => R


export function launch<T>(node: ReactiveTreeNode<T>, triggers?: unknown): ReactiveTreeNode<T> {
  ReactiveTreeNode.launchScript(node, triggers)
  return node
}

// ReactiveTreeNode

export abstract class ReactiveTreeNode<E = unknown> {
  static readonly shortFrameDuration = 16 // ms
  static readonly longFrameDuration = 300 // ms
  static frameDuration = ReactiveTreeNode.longFrameDuration
  static currentScriptPriority = Priority.realtime

  abstract readonly key: string
  abstract readonly driver: ReactiveTreeNodeDriver<E>
  abstract readonly declaration: Readonly<ReactiveTreeNodeDecl<E>/* | ReactiveTreeNodeDeclAsync<E>*/>
  abstract readonly level: number
  abstract readonly owner: ReactiveTreeNode
  abstract element: E
  abstract readonly host: ReactiveTreeNode
  abstract readonly children: MergeListReader<ReactiveTreeNode>
  abstract readonly slot: MergedItem<ReactiveTreeNode<E>> | undefined
  abstract readonly stamp: number
  abstract readonly outer: ReactiveTreeNode
  abstract readonly context: ReactiveTreeNodeContext | undefined
  abstract priority?: Priority
  abstract childrenShuffling: boolean
  abstract strictOrder: boolean
  abstract getUri(relativeTo?: ReactiveTreeNode<any>): string
  abstract has(mode: Mode): boolean
  abstract configureReactivity(options: Partial<ReactivityOptions>): ReactivityOptions

  static get current(): ReactiveTreeNode {
    return ReactiveTreeNodeImpl.nodeSlot.instance
  }

  static get isFirstScriptRun(): boolean {
    return ReactiveTreeNode.current.stamp === 1
  }

  static declare<E = void>(
    driver: ReactiveTreeNodeDriver<E>,
    script?: Script<E>,
    scriptAsync?: ScriptAsync<E>,
    key?: string,
    mode?: Mode,
    preparation?: Script<E>,
    preparationAsync?: ScriptAsync<E>,
    finalization?: Script<E>,
    triggers?: unknown,
    basis?: ReactiveTreeNodeDecl<E>): ReactiveTreeNode<E>

  static declare<E = void>(
    driver: ReactiveTreeNodeDriver<E>,
    declaration?: ReactiveTreeNodeDecl<E>): ReactiveTreeNode<E>

  static declare<E = void>(
    driver: ReactiveTreeNodeDriver<E>,
    scriptOrDeclaration?: Script<E> | ReactiveTreeNodeDecl<E>,
    scriptAsync?: ScriptAsync<E>,
    key?: string,
    mode?: Mode,
    preparation?: Script<E>,
    preparationAsync?: ScriptAsync<E>,
    finalization?: Script<E>,
    triggers?: unknown,
    basis?: ReactiveTreeNodeDecl<E>):  ReactiveTreeNode<E>

  static declare<E = void>(
    driver: ReactiveTreeNodeDriver<E>,
    scriptOrDeclaration?: Script<E> | ReactiveTreeNodeDecl<E>,
    scriptAsync?: ScriptAsync<E>,
    key?: string,
    mode?: Mode,
    preparation?: Script<E>,
    preparationAsync?: ScriptAsync<E>,
    finalization?: Script<E>,
    triggers?: unknown,
    basis?: ReactiveTreeNodeDecl<E>):  ReactiveTreeNode<E> {
    let result: ReactiveTreeNodeImpl<E>
    let declaration: ReactiveTreeNodeDecl<E>
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
    const owner = gNodeSlot?.instance
    if (owner) {
      let existing = owner.driver.declareChild(owner, driver, declaration, declaration.basis)
      // Reuse existing node or declare a new one
      const children = owner.children
      existing ??= children.tryMergeAsExisting(
        effectiveKey = effectiveKey || generateKey(owner), undefined,
        "nested elements can be declared inside 'script' only")
      if (existing) {
        // Reuse existing node
        result = existing.instance as ReactiveTreeNodeImpl<E>
        if (result.driver !== driver && driver !== undefined)
          throw misuse(`changing element driver is not yet supported: "${result.driver.name}" -> "${driver?.name}"`)
        const exTriggers = result.declaration.triggers
        if (observablesAreEqual(declaration.triggers, exTriggers))
          declaration.triggers = exTriggers // preserve triggers instance
        result.declaration = declaration
      }
      else {
        // Create new node
        result = new ReactiveTreeNodeImpl<E>(effectiveKey || generateKey(owner), driver, declaration, owner)
        result.slot = children.mergeAsAdded(result as ReactiveTreeNodeImpl<unknown>) as MergedItem<ReactiveTreeNodeImpl<E>>
      }
    }
    else {
      // Create new root node
      result = new ReactiveTreeNodeImpl(effectiveKey || generateKey(owner), driver, declaration, owner)
      result.slot = MergeList.createItem(result)
    }
    return result
  }

  static withBasis<E = void>(
    declaration?: ReactiveTreeNodeDecl<E>,
    basis?: ReactiveTreeNodeDecl<E>): ReactiveTreeNodeDecl<E> {
    if (declaration)
      declaration.basis = basis
    else
      declaration = basis ?? {}
    return declaration
  }

  static launchScript(node: ReactiveTreeNode<any>, triggers: unknown): void {
    const impl = node as ReactiveTreeNodeImpl<any>
    const declaration = impl.declaration
    if (node.stamp >= Number.MAX_SAFE_INTEGER || !observablesAreEqual(triggers, declaration.triggers)) {
      declaration.triggers = triggers // remember new triggers
      launchScriptViaSlot(impl.slot!)
    }
  }

  static launchFinalization(node: ReactiveTreeNode<any>): void {
    const impl = node as ReactiveTreeNodeImpl<any>
    launchFinalization(impl.slot!, true, true)
  }

  static runNestedNodeScriptsThenDo(action: (error: unknown) => void): void {
    runNestedNodeScriptsThenDoImpl(ReactiveTreeNodeImpl.nodeSlot, undefined, action)
  }

  static markAsMounted(node: ReactiveTreeNode<any>, yes: boolean): void {
    const n = node as ReactiveTreeNodeImpl<any>
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
      result = result.children.lookup(segments[i])?.instance as ReactiveTreeNode<E>
    return result
  }

  static findMatchingHost<E = unknown, R = unknown>(
    node: ReactiveTreeNode<E>, match: Handler<ReactiveTreeNode<E>, boolean>): ReactiveTreeNode<R> | undefined {
    let p = node.host as ReactiveTreeNodeImpl<any>
    while (p !== p.host && !match(p))
      p = p.host
    return p
  }

  static findMatchingPrevSibling<E = unknown, R = unknown>(
    node: ReactiveTreeNode<E>, match: Handler<ReactiveTreeNode<E>, boolean>): ReactiveTreeNode<R> | undefined {
    let p = node.slot!.prev
    while (p && !match(p.instance))
      p = p.prev
    return p?.instance as ReactiveTreeNode<R> | undefined
  }

  static forEachChildRecursively<E = unknown>(
    node: ReactiveTreeNode<E>, action: Handler<ReactiveTreeNode<E>>): void {
    action(node)
    for (const child of node.children.items())
      ReactiveTreeNode.forEachChildRecursively<E>(child.instance as ReactiveTreeNode<any>, action)
  }

  static getDefaultLoggingOptions(): LoggingOptions | undefined {
    return ReactiveTreeNodeImpl.logging
  }

  static setDefaultLoggingOptions(logging?: LoggingOptions): void {
    ReactiveTreeNodeImpl.logging = logging
  }
}

// ReactiveTreeNodeDecl

export type ReactiveTreeNodeDecl<E = unknown> = {
  script?: Script<E>                // скрипт
  scriptAsync?: ScriptAsync<E>      // скрипт-задача
  key?: string                      // ключ
  mode?: Mode                       // режим
  preparation?: Script<E>           // подготовка
  preparationAsync?: ScriptAsync<E> // подготовка-задача
  finalization?: Script<E>          // завершение
  triggers?: unknown                // триггеры
  basis?: ReactiveTreeNodeDecl<E>   // базис
}

// ReactiveTreeNodeDriver

export type ReactiveTreeNodeDriver<E = unknown> = {
  readonly name: string,
  readonly isPartition: boolean,
  readonly initialize?: Handler<E>

  create(node: ReactiveTreeNode<E>): E

  runPreparation(node: ReactiveTreeNode<E>): void

  runFinalization(node: ReactiveTreeNode<E>, isLeader: boolean): boolean

  runMount(node: ReactiveTreeNode<E>): void

  runScript(node: ReactiveTreeNode<E>): void | Promise<void>

  declareChild(ownerNode: ReactiveTreeNode<E>,
    childDriver: ReactiveTreeNodeDriver<any>,
    childDeclaration?: ReactiveTreeNodeDecl<any>,
    childBasis?: ReactiveTreeNodeDecl<any>): MergedItem<ReactiveTreeNode> | undefined

  provideHost(node: ReactiveTreeNode<E>): ReactiveTreeNode<E>
}

// ReactiveTreeNodeContext

export type ReactiveTreeNodeContext<T extends Object = Object> = {
  value: T
}

// BaseDriver

export abstract class BaseDriver<E = unknown> implements ReactiveTreeNodeDriver<E> {
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
    childDriver: ReactiveTreeNodeDriver<any>,
    childDeclaration?: ReactiveTreeNodeDecl<any>,
    childBasis?: ReactiveTreeNodeDecl<any>): MergedItem<ReactiveTreeNode> | undefined {
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
    ReactiveTreeNodeImpl.setTreeVariableValue(this, value)
  }

  get value(): T {
    return ReactiveTreeNodeImpl.useTreeVariableValue(this)
  }

  get valueOrUndefined(): T | undefined {
    return ReactiveTreeNodeImpl.tryUseTreeVariableValue(this)
  }
}

// Utils

export function generateKey(owner?: ReactiveTreeNodeImpl): string {
  const n = owner !== undefined ? owner.numerator++ : 0
  const lettered = emitLetters(n)
  let result: string
  if (ReactiveSystem.isLogging)
    result = `·${getCallerInfo(lettered)}`
  else
    result = `·${lettered}`
  return result
}

export function getModeUsingBasisChain(declaration?: ReactiveTreeNodeDecl<any>): Mode {
  return declaration?.mode ?? (declaration?.basis ? getModeUsingBasisChain(declaration?.basis) : Mode.default)
}

function invokeScriptUsingBasisChain(element: unknown, declaration: ReactiveTreeNodeDecl<any>): void | Promise<void> {
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

function invokePreparationUsingBasisChain(element: unknown, declaration: ReactiveTreeNodeDecl<any>): void | Promise<void> {
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

function invokeFinalizationUsingBasisChain(element: unknown, declaration: ReactiveTreeNodeDecl<any>): void {
  const basis = declaration.basis
  const finalization = declaration.finalization
  if (finalization)
    finalization(element, basis ? () => invokeFinalizationUsingBasisChain(element, basis) : NOP)
  else if (basis)
    invokeFinalizationUsingBasisChain(element, basis)
}

// ReactiveTreeNodeContextImpl

class ReactiveTreeNodeContextImpl<T extends Object = Object> extends ObservableObject implements ReactiveTreeNodeContext<T> {
  @observable(false) next: ReactiveTreeNodeContextImpl<object> | undefined
  @observable(false) variable: ReactiveTreeVariable<T>
  value: T

  constructor(variable: ReactiveTreeVariable<T>, value: T) {
    super()
    this.next = undefined
    this.variable = variable
    this.value = value
  }
}

// ReactiveTreeNodeImpl

class ReactiveTreeNodeImpl<E = unknown> extends ReactiveTreeNode<E> {
  static logging: LoggingOptions | undefined = undefined
  static grandNodeCount: number = 0
  static disposableNodeCount: number = 0

  readonly key: string
  readonly driver: ReactiveTreeNodeDriver<E>
  declaration: ReactiveTreeNodeDecl<E>
  readonly level: number
  readonly owner: ReactiveTreeNodeImpl
  readonly element: E
  host: ReactiveTreeNodeImpl
  readonly children: MergeList<ReactiveTreeNodeImpl>
  slot: MergedItem<ReactiveTreeNodeImpl<E>> | undefined
  stamp: number
  outer: ReactiveTreeNodeImpl
  context: ReactiveTreeNodeContextImpl<any> | undefined
  numerator: number
  priority: Priority
  childrenShuffling: boolean

  constructor(
    key: string, driver: ReactiveTreeNodeDriver<E>,
    declaration: Readonly<ReactiveTreeNodeDecl<E>>,
    owner: ReactiveTreeNodeImpl | undefined) {
    super()
    const thisAsUnknown = this as ReactiveTreeNodeImpl<unknown>
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
    this.children = new MergeList<ReactiveTreeNodeImpl>(getNodeKey, true)
    this.slot = undefined
    this.stamp = Number.MAX_SAFE_INTEGER // newly created
    this.context = undefined
    this.numerator = 0
    this.priority = Priority.realtime
    this.childrenShuffling = false
    // Monitoring
    ReactiveTreeNodeImpl.grandNodeCount++
    if (this.has(Mode.autonomous))
      ReactiveTreeNodeImpl.disposableNodeCount++
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
    return this.children.isStrict
  }

  set strictOrder(value: boolean) {
    this.children.isStrict = value
  }

  get isMoved(): boolean {
    return this.owner.children.isMoved(this.slot! as MergedItem<ReactiveTreeNodeImpl>)
  }

  has(mode: Mode): boolean {
    return flags(getModeUsingBasisChain(this.declaration), mode)
  }

  @reactive
  @options({
    reentrance: Reentrance.cancelAndWaitPrevious,
    allowObsoleteToFinish: true,
    observableArgs: true,
    noSideEffects: false,
  })
  script(_triggers: unknown): void {
    // triggers parameter is used to enforce script run by owner
    runScriptNow(this.slot!)
  }

  configureReactivity(options: Partial<ReactivityOptions>): ReactivityOptions {
    if (this.stamp < Number.MAX_SAFE_INTEGER - 1 || !this.has(Mode.autonomous))
      throw misuse("reactronic can be configured only for elements with autonomous mode and only during preparation")
    return manageReactiveOperation(this.script).configure(options)
  }

  static get nodeSlot(): MergedItem<ReactiveTreeNodeImpl> {
    if (!gNodeSlot)
      throw misuse("current element is undefined")
    return gNodeSlot
  }

  static tryUseTreeVariableValue<T extends Object>(variable: ReactiveTreeVariable<T>): T | undefined {
    let node = ReactiveTreeNodeImpl.nodeSlot.instance
    while (node.context?.variable !== variable && node.owner !== node)
      node = node.outer.slot!.instance
    return node.context?.value as any // TODO: to get rid of any
  }

  static useTreeVariableValue<T extends Object>(variable: ReactiveTreeVariable<T>): T {
    const result = ReactiveTreeNodeImpl.tryUseTreeVariableValue(variable) ?? variable.defaultValue
    if (!result)
      throw misuse("unknown node variable")
    return result
  }

  static setTreeVariableValue<T extends Object>(variable: ReactiveTreeVariable<T>, value: T | undefined): void {
    const node = ReactiveTreeNodeImpl.nodeSlot.instance
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
          node.context = new ReactiveTreeNodeContextImpl<any>(variable, value)
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

function runNestedNodeScriptsThenDoImpl(nodeSlot: MergedItem<ReactiveTreeNodeImpl<any>>, error: unknown, action: (error: unknown) => void): void {
  runInsideContextOfNode(nodeSlot, () => {
    const owner = nodeSlot.instance
    const children = owner.children
    if (children.isMergeInProgress) {
      let promised: Promise<void> | undefined = undefined
      try {
        children.endMerge(error)
        // Deactivate removed elements
        for (const child of children.removedItems(true))
          launchFinalization(child, true, true)
        if (!error) {
          // Lay out and update actual elements
          const sequential = children.isStrict
          let p1: Array<MergedItem<ReactiveTreeNodeImpl>> | undefined = undefined
          let p2: Array<MergedItem<ReactiveTreeNodeImpl>> | undefined = undefined
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
              launchScriptViaSlot(child) // synchronously
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

function markToMountIfNecessary(mounting: boolean, host: ReactiveTreeNodeImpl,
  nodeSlot: MergedItem<ReactiveTreeNodeImpl>, children: MergeList<ReactiveTreeNodeImpl>, sequential: boolean): boolean {
  // Detects element mounting when abstract elements
  // exist among regular elements having native HTML elements
  const node = nodeSlot.instance
  // TODO: Get rid of "node.element.native"
  if ((node.element as any).native && !node.has(Mode.external)) {
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
  ownerSlot: MergedItem<ReactiveTreeNodeImpl>,
  allChildren: MergeList<ReactiveTreeNodeImpl>,
  priority1?: Array<MergedItem<ReactiveTreeNodeImpl>>,
  priority2?: Array<MergedItem<ReactiveTreeNodeImpl>>): Promise<void> {
  const stamp = ownerSlot.instance.stamp
  if (priority1)
    await runNestedScriptsIncrementally(ownerSlot, stamp, allChildren, priority1, Priority.normal)
  if (priority2)
    await runNestedScriptsIncrementally(ownerSlot, stamp, allChildren, priority2, Priority.background)
}

async function runNestedScriptsIncrementally(owner: MergedItem<ReactiveTreeNodeImpl>, stamp: number,
  allChildren: MergeList<ReactiveTreeNodeImpl>, items: Array<MergedItem<ReactiveTreeNodeImpl>>,
  priority: Priority): Promise<void> {
  await Transaction.requestNextFrame()
  const node = owner.instance
  if (!Transaction.isCanceled || !Transaction.isFrameOver(1, ReactiveTreeNodeImpl.shortFrameDuration / 3)) {
    let outerPriority = ReactiveTreeNodeImpl.currentScriptPriority
    ReactiveTreeNodeImpl.currentScriptPriority = priority
    try {
      if (node.childrenShuffling)
        shuffle(items)
      const frameDurationLimit = priority === Priority.background ? ReactiveTreeNode.shortFrameDuration : Infinity
      let frameDuration = Math.min(frameDurationLimit, Math.max(ReactiveTreeNode.frameDuration / 4, ReactiveTreeNode.shortFrameDuration))
      for (const child of items) {
        launchScriptViaSlot(child)
        if (Transaction.isFrameOver(1, frameDuration)) {
          ReactiveTreeNodeImpl.currentScriptPriority = outerPriority
          await Transaction.requestNextFrame(0)
          outerPriority = ReactiveTreeNodeImpl.currentScriptPriority
          ReactiveTreeNodeImpl.currentScriptPriority = priority
          frameDuration = Math.min(4 * frameDuration, Math.min(frameDurationLimit, ReactiveTreeNode.frameDuration))
        }
        if (Transaction.isCanceled && Transaction.isFrameOver(1, ReactiveTreeNode.shortFrameDuration / 3))
          break
      }
    }
    finally {
      ReactiveTreeNodeImpl.currentScriptPriority = outerPriority
    }
  }
}

function launchScriptViaSlot(nodeSlot: MergedItem<ReactiveTreeNodeImpl<any>>): void {
  const node = nodeSlot.instance
  if (node.stamp >= 0) { // if not deactivated yet
    if (node.has(Mode.autonomous)) {
      if (node.stamp === Number.MAX_SAFE_INTEGER) {
        Transaction.outside(() => {
          if (ReactiveSystem.isLogging)
            ReactiveSystem.setLoggingHint(node.element, node.key)
          manageReactiveOperation(node.script).configure({
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

function mountOrRemountIfNecessary(node: ReactiveTreeNodeImpl): void {
  const driver = node.driver
  if (node.stamp === Number.MAX_SAFE_INTEGER) {
    runNonReactively(() => {
      node.stamp = Number.MAX_SAFE_INTEGER - 1 // mark as activated
      driver.runPreparation(node)
      if (!node.has(Mode.external)) {
        node.stamp = 0 // mark as mounted
        if (node.host !== node)
          driver.runMount(node) // initial mount
      }
    })
  }
  else if (node.isMoved && !node.has(Mode.external) && node.host !== node)
    runNonReactively(() => driver.runMount(node)) // re-mount
}

function runScriptNow(nodeSlot: MergedItem<ReactiveTreeNodeImpl<any>>): void {
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

function launchFinalization(nodeSlot: MergedItem<ReactiveTreeNodeImpl>, isLeader: boolean, individual: boolean): void {
  const node = nodeSlot.instance
  if (node.stamp >= 0) {
    const driver = node.driver
    if (individual && node.key !== node.declaration.key && !driver.isPartition)
      console.log(`WARNING: it is recommended to assign explicit key for conditional element in order to avoid unexpected side effects: ${node.key}`)
    node.stamp = ~node.stamp
    // Finalize element itself and remove it from collection
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
    // Finalize children
    for (const child of node.children.items())
      launchFinalization(child, childrenAreLeaders, false)
    ReactiveTreeNodeImpl.grandNodeCount--
  }
}

async function runDisposalLoop(): Promise<void> {
  await Transaction.requestNextFrame()
  let slot = gFirstToDispose
  while (slot !== undefined) {
    if (Transaction.isFrameOver(500, 5))
      await Transaction.requestNextFrame()
    disposeObservableObject(slot.instance)
    slot = slot.aux
    ReactiveTreeNodeImpl.disposableNodeCount--
  }
  // console.log(`Element count: ${ReactiveTreeNodeImpl.grandNodeCount} totally (${ReactiveTreeNodeImpl.disposableNodeCount} disposable)`)
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

function runInsideContextOfNode<T>(nodeSlot: MergedItem<ReactiveTreeNodeImpl>, func: (...args: any[]) => T, ...args: any[]): T {
  const outer = gNodeSlot
  try {
    gNodeSlot = nodeSlot
    return func(...args)
  }
  finally {
    gNodeSlot = outer
  }
}

export function observablesAreEqual(a1: any, a2: any): boolean {
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

let gNodeSlot: MergedItem<ReactiveTreeNodeImpl> | undefined = undefined
let gFirstToDispose: MergedItem<ReactiveTreeNodeImpl> | undefined = undefined
let gLastToDispose: MergedItem<ReactiveTreeNodeImpl> | undefined = undefined
