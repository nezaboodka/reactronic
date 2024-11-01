// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2024 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "../util/Dbg.js"
import { LoggingOptions } from "../Logging.js"
import { MergeList, MergeListReader, MergedItem } from "../util/MergeList.js"
import { emitLetters, getCallerInfo, proceedSyncOrAsync } from "../util/Utils.js"
import { Isolation, MemberOptions, Reentrance } from "../Options.js"
import { ObservableObject } from "../core/Mvcc.js"
import { Transaction } from "../core/Transaction.js"
import { ReactiveSystem, options, raw, reactive, unobs } from "../ReactiveSystem.js"

// Scripts

export type Script<E> = (el: E, basis: () => void) => void
export type ScriptAsync<E> = (el: E, basis: () => Promise<void>) => Promise<void>
export type Handler<E = unknown, R = void> = (el: E) => R

// Enums

export enum Mode {
  default = 0,
  autonomous = 1,
  manualMount = 2,
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
  abstract readonly seat: MergedItem<ReactiveNode<E>> | undefined
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
  static currentUpdatePriority = Priority.realtime
  static frameDuration = ReactiveNode.longFrameDuration

  static declare<E = void>(
    driver: ReactiveNodeDriver<E>,
    content?: Script<E>,
    contentAsync?: ScriptAsync<E>,
    key?: string,
    mode?: Mode,
    creation?: Script<E>,
    creationAsync?: ScriptAsync<E>,
    destruction?: Script<E>,
    triggers?: unknown,
    basis?: ReactiveNodeDecl<E>): ReactiveNode<E>

  static declare<E = void>(
    driver: ReactiveNodeDriver<E>,
    declaration?: ReactiveNodeDecl<E>): ReactiveNode<E>

  static declare<E = void>(
    driver: ReactiveNodeDriver<E>,
    contentOrDeclaration?: Script<E> | ReactiveNodeDecl<E>,
    contentAsync?: ScriptAsync<E>,
    key?: string,
    mode?: Mode,
    creation?: Script<E>,
    creationAsync?: ScriptAsync<E>,
    destruction?: Script<E>,
    triggers?: unknown,
    basis?: ReactiveNodeDecl<E>):  ReactiveNode<E>

  static declare<E = void>(
    driver: ReactiveNodeDriver<E>,
    contentOrDeclaration?: Script<E> | ReactiveNodeDecl<E>,
    contentAsync?: ScriptAsync<E>,
    key?: string,
    mode?: Mode,
    creation?: Script<E>,
    creationAsync?: ScriptAsync<E>,
    destruction?: Script<E>,
    triggers?: unknown,
    basis?: ReactiveNodeDecl<E>):  ReactiveNode<E> {
    let result: ReactiveNodeImpl<E>
    let declaration: ReactiveNodeDecl<E>
    // Normalize parameters
    if (contentOrDeclaration instanceof Function) {
      declaration = {
        content: contentOrDeclaration, contentAsync, key, mode,
        creation, creationAsync, destruction, triggers, basis,
      }
    }
    else
      declaration = contentOrDeclaration ?? {}
    let effectiveKey = declaration.key
    const owner = gOwnSeat?.instance
    if (owner) {
      let existing = owner.driver.child(owner, driver, declaration, declaration.basis)
      // Reuse existing node or declare a new one
      const children = owner.children
      existing ??= children.tryMergeAsExisting(
        effectiveKey = effectiveKey || generateKey(owner), undefined,
        "nested elements can be declared inside content script only")
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
        result.seat = children.mergeAsAdded(result as ReactiveNodeImpl<unknown>) as MergedItem<ReactiveNodeImpl<E>>
      }
    }
    else {
      // Create new root node
      result = new ReactiveNodeImpl(effectiveKey || "", driver, declaration, owner)
      result.seat = MergeList.createItem(result)
      triggerUpdateViaSeat(result.seat)
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

  static get isFirstUpdate(): boolean {
    return ReactiveNodeImpl.ownSeat.instance.stamp === 1
  }

  static get key(): string {
    return ReactiveNodeImpl.ownSeat.instance.key
  }

  static get stamp(): number {
    return ReactiveNodeImpl.ownSeat.instance.stamp
  }

  static get triggers(): unknown {
    return ReactiveNodeImpl.ownSeat.instance.declaration.triggers
  }

  static get priority(): Priority {
    return ReactiveNodeImpl.ownSeat.instance.priority
  }

  static set priority(value: Priority) {
    ReactiveNodeImpl.ownSeat.instance.priority = value
  }

  static get childrenShuffling(): boolean {
    return ReactiveNodeImpl.ownSeat.instance.childrenShuffling
  }

  static set childrenShuffling(value: boolean) {
    ReactiveNodeImpl.ownSeat.instance.childrenShuffling = value
  }

  static triggerUpdate(node: ReactiveNode<any>, triggers: unknown): void {
    const impl = node as ReactiveNodeImpl<any>
    const declaration = impl.declaration
    if (!triggersAreEqual(triggers, declaration.triggers)) {
      declaration.triggers = triggers // remember new triggers
      triggerUpdateViaSeat(impl.seat!)
    }
  }

  static triggerDeactivation(node: ReactiveNode<any>): void {
    const impl = node as ReactiveNodeImpl<any>
    triggerDeactivation(impl.seat!, true, true)
  }

  static updateNestedNodesThenDo(action: (error: unknown) => void): void {
    runUpdateNestedNodesThenDo(ReactiveNodeImpl.ownSeat, undefined, action)
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
    let p = node.seat!.prev
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
  content?: Script<E>
  contentAsync?: ScriptAsync<E>
  key?: string
  mode?: Mode
  creation?: Script<E>
  creationAsync?: ScriptAsync<E>
  destruction?: Script<E>
  triggers?: unknown
  basis?: ReactiveNodeDecl<E>
}

// ReactiveNodeDriver

export type ReactiveNodeDriver<E = unknown> = {
  readonly name: string,
  readonly isPartition: boolean,
  readonly initialize?: Handler<E>

  allocate(node: ReactiveNode<E>): E
  create(node: ReactiveNode<E>): void
  destroy(node: ReactiveNode<E>, isLeader: boolean): boolean
  mount(node: ReactiveNode<E>): void
  update(node: ReactiveNode<E>): void | Promise<void>
  child(ownerNode: ReactiveNode<E>,
    childDriver: ReactiveNodeDriver<any>,
    childDeclaration?: ReactiveNodeDecl<any>,
    childBasis?: ReactiveNodeDecl<any>): MergedItem<ReactiveNode> | undefined

  getHost(node: ReactiveNode<E>): ReactiveNode<E>
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

  abstract allocate(node: ReactiveNode<E>): E

  create(node: ReactiveNode<E>): void | Promise<void> {
    this.initialize?.(node.element)
    return invokeCreationUsingBasisChain(node.element, node.declaration)
  }

  destroy(node: ReactiveNode<E>, isLeader: boolean): boolean {
    invokeDestructionUsingBasisChain(node.element, node.declaration)
    return isLeader // treat children as deactivation leaders as well
  }

  mount(node: ReactiveNode<E>): void {
    // nothing to do by default
  }

  update(node: ReactiveNode<E>): void | Promise<void> {
    return invokeContentUsingBasisChain(node.element, node.declaration)
  }

  child(ownerNode: ReactiveNode<E>,
    childDriver: ReactiveNodeDriver<any>,
    childDeclaration?: ReactiveNodeDecl<any>,
    childBasis?: ReactiveNodeDecl<any>): MergedItem<ReactiveNode> | undefined {
    return undefined
  }

  getHost(node: ReactiveNode<E>): ReactiveNode<E> {
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

function invokeContentUsingBasisChain(element: unknown, declaration: ReactiveNodeDecl<any>): void | Promise<void> {
  let result: void | Promise<void> = undefined
  const basis = declaration.basis
  const content = declaration.content
  const contentAsync = declaration.contentAsync
  if (content && contentAsync)
    throw misuse("'content' and 'contentAsync' cannot be defined together")
  if (content)
    result = content(element, basis ? () => invokeContentUsingBasisChain(element, basis) : NOP)
  else if (contentAsync)
    result = contentAsync(element, basis ? () => invokeContentUsingBasisChain(element, basis) : NOP_ASYNC)
  else if (basis)
    result = invokeContentUsingBasisChain(element, basis)
  return result
}

function invokeCreationUsingBasisChain(element: unknown, declaration: ReactiveNodeDecl<any>): void | Promise<void> {
  let result: void | Promise<void> = undefined
  const basis = declaration.basis
  const creation = declaration.creation
  const creationAsync = declaration.creationAsync
  if (creation && creationAsync)
    throw misuse("'creation' and 'creationAsync' cannot be defined together")
  if (creation)
    result = creation(element, basis ? () => invokeCreationUsingBasisChain(element, basis) : NOP)
  else if (creationAsync)
    result = creationAsync(element, basis ? () => invokeCreationUsingBasisChain(element, basis) : NOP_ASYNC)
  else if (basis)
    result = invokeCreationUsingBasisChain(element, basis)
  return result
}

function invokeDestructionUsingBasisChain(element: unknown, declaration: ReactiveNodeDecl<any>): void {
  const basis = declaration.basis
  const destruction = declaration.destruction
  if (destruction)
    destruction(element, basis ? () => invokeDestructionUsingBasisChain(element, basis) : NOP)
  else if (basis)
    invokeDestructionUsingBasisChain(element, basis)
}

// ReactiveNodeContextImpl

class ReactiveNodeContextImpl<T extends Object = Object> extends ObservableObject implements ReactiveNodeContext<T> {
  @raw next: ReactiveNodeContextImpl<object> | undefined
  @raw variable: ReactiveNodeVariable<T>
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
  seat: MergedItem<ReactiveNodeImpl<E>> | undefined
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
    this.element = driver.allocate(this)
    this.host = thisAsUnknown // node is unmounted
    this.children = new MergeList<ReactiveNodeImpl>(getNodeKey, true)
    this.seat = undefined
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

  get isMoved(): boolean { return this.owner.children.isMoved(this.seat! as MergedItem<ReactiveNodeImpl>) }

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
  update(_triggers: unknown): void {
    // triggers parameter is used to enforce update by owner
    updateNow(this.seat!)
  }

  configureReactronic(options: Partial<MemberOptions>): MemberOptions {
    if (this.stamp < Number.MAX_SAFE_INTEGER - 1 || !this.has(Mode.autonomous))
      throw new Error("reactronic can be configured only for elements with autonomous mode and only during activation")
    return ReactiveSystem.getOperation(this.update).configure(options)
  }

  static get ownSeat(): MergedItem<ReactiveNodeImpl> {
    if (!gOwnSeat)
      throw new Error("current element is undefined")
    return gOwnSeat
  }

  static tryUseNodeVariableValue<T extends Object>(variable: ReactiveNodeVariable<T>): T | undefined {
    let node = ReactiveNodeImpl.ownSeat.instance
    while (node.context?.variable !== variable && node.owner !== node)
      node = node.outer.seat!.instance
    return node.context?.value as any // TODO: to get rid of any
  }

  static useNodeVariableValue<T extends Object>(variable: ReactiveNodeVariable<T>): T {
    const result = ReactiveNodeImpl.tryUseNodeVariableValue(variable) ?? variable.defaultValue
    if (!result)
      throw new Error("unknown node variable")
    return result
  }

  static setNodeVariableValue<T extends Object>(variable: ReactiveNodeVariable<T>, value: T | undefined): void {
    const node = ReactiveNodeImpl.ownSeat.instance
    const owner = node.owner
    const hostCtx = unobs(() => owner.context?.value)
    if (value && value !== hostCtx) {
      if (hostCtx)
        node.outer = owner
      else
        node.outer = owner.outer
      Transaction.run({ isolation: Isolation.joinAsNestedTransaction }, () => {
        const ctx = node.context
        if (ctx) {
          ctx.variable = variable
          ctx.value = value // update context thus invalidate observers
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

function runUpdateNestedNodesThenDo(ownSeat: MergedItem<ReactiveNodeImpl<any>>, error: unknown, action: (error: unknown) => void): void {
  runInside(ownSeat, () => {
    const owner = ownSeat.instance
    const children = owner.children
    if (children.isMergeInProgress) {
      let promised: Promise<void> | undefined = undefined
      try {
        children.endMerge(error)
        // Deactivate removed elements
        for (const child of children.removedItems(true))
          triggerDeactivation(child, true, true)
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
              triggerUpdateViaSeat(child) // update synchronously
            else if (p === Priority.normal)
              p1 = push(child, p1) // defer for P1 async update
            else
              p2 = push(child, p2) // defer for P2 async update
            if (isPart)
              partition = childNode
          }
          // Update incremental children (if any)
          if (!Transaction.isCanceled && (p1 !== undefined || p2 !== undefined))
            promised = startIncrementalUpdate(ownSeat, children, p1, p2).then(
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
  seat: MergedItem<ReactiveNodeImpl>, children: MergeList<ReactiveNodeImpl>, sequential: boolean): boolean {
  // Detects element mounting when abstract elements
  // exist among regular elements having native HTML elements
  const node = seat.instance
  // TODO: Get rid of "node.element.native"
  if ((node.element as any).native && !node.has(Mode.manualMount)) {
    if (mounting || node.host !== host) {
      children.markAsMoved(seat)
      mounting = false
    }
  }
  else if (sequential && children.isMoved(seat))
    mounting = true // apply to the first element having native HTML element
  node.host = host
  return mounting
}

async function startIncrementalUpdate(
  ownerSeat: MergedItem<ReactiveNodeImpl>,
  allChildren: MergeList<ReactiveNodeImpl>,
  priority1?: Array<MergedItem<ReactiveNodeImpl>>,
  priority2?: Array<MergedItem<ReactiveNodeImpl>>): Promise<void> {
  const stamp = ownerSeat.instance.stamp
  if (priority1)
    await updateIncrementally(ownerSeat, stamp, allChildren, priority1, Priority.normal)
  if (priority2)
    await updateIncrementally(ownerSeat, stamp, allChildren, priority2, Priority.background)
}

async function updateIncrementally(owner: MergedItem<ReactiveNodeImpl>, stamp: number,
  allChildren: MergeList<ReactiveNodeImpl>, items: Array<MergedItem<ReactiveNodeImpl>>,
  priority: Priority): Promise<void> {
  await Transaction.requestNextFrame()
  const node = owner.instance
  if (!Transaction.isCanceled || !Transaction.isFrameOver(1, ReactiveNode.shortFrameDuration / 3)) {
    let outerPriority = ReactiveNode.currentUpdatePriority
    ReactiveNode.currentUpdatePriority = priority
    try {
      if (node.childrenShuffling)
        shuffle(items)
      const frameDurationLimit = priority === Priority.background ? ReactiveNode.shortFrameDuration : Infinity
      let frameDuration = Math.min(frameDurationLimit, Math.max(ReactiveNode.frameDuration / 4, ReactiveNode.shortFrameDuration))
      for (const child of items) {
        triggerUpdateViaSeat(child)
        if (Transaction.isFrameOver(1, frameDuration)) {
          ReactiveNode.currentUpdatePriority = outerPriority
          await Transaction.requestNextFrame(0)
          outerPriority = ReactiveNode.currentUpdatePriority
          ReactiveNode.currentUpdatePriority = priority
          frameDuration = Math.min(4 * frameDuration, Math.min(frameDurationLimit, ReactiveNode.frameDuration))
        }
        if (Transaction.isCanceled && Transaction.isFrameOver(1, ReactiveNode.shortFrameDuration / 3))
          break
      }
    }
    finally {
      ReactiveNode.currentUpdatePriority = outerPriority
    }
  }
}

function triggerUpdateViaSeat(seat: MergedItem<ReactiveNodeImpl<any>>): void {
  const node = seat.instance
  if (node.stamp >= 0) { // if not deactivated yet
    if (node.has(Mode.autonomous)) {
      if (node.stamp === Number.MAX_SAFE_INTEGER) {
        Transaction.outside(() => {
          if (ReactiveSystem.isLogging)
            ReactiveSystem.setLoggingHint(node.element, node.key)
          ReactiveSystem.getOperation(node.update).configure({
            order: node.level,
          })
        })
      }
      unobs(node.update, node.declaration.triggers) // reactive auto-update
    }
    else
      updateNow(seat)
  }
}

function mountOrRemountIfNecessary(node: ReactiveNodeImpl): void {
  const driver = node.driver
  if (node.stamp === Number.MAX_SAFE_INTEGER) {
    unobs(() => {
      node.stamp = Number.MAX_SAFE_INTEGER - 1 // mark as activated
      driver.create(node)
      if (!node.has(Mode.manualMount)) {
        node.stamp = 0 // mark as mounted
        if (node.host !== node)
          driver.mount(node)
      }
    })
  }
  else if (node.isMoved && !node.has(Mode.manualMount) && node.host !== node)
    unobs(() => driver.mount(node))
}

function updateNow(seat: MergedItem<ReactiveNodeImpl<any>>): void {
  const node = seat.instance
  if (node.stamp >= 0) { // if element is alive
    let result: unknown = undefined
    runInside(seat, () => {
      mountOrRemountIfNecessary(node)
      if (node.stamp < Number.MAX_SAFE_INTEGER - 1) { // if mounted
        try {
          node.stamp++
          node.numerator = 0
          node.children.beginMerge()
          const driver = node.driver
          result = driver.update(node)
          result = proceedSyncOrAsync(result,
            v => { runUpdateNestedNodesThenDo(seat, undefined, NOP); return v },
            e => { console.log(e); runUpdateNestedNodesThenDo(seat, e ?? new Error("unknown error"), NOP) })
        }
        catch (e: unknown) {
          runUpdateNestedNodesThenDo(seat, e, NOP)
          console.log(`Update failed: ${node.key}`)
          console.log(`${e}`)
        }
      }
    })
  }
}

function triggerDeactivation(seat: MergedItem<ReactiveNodeImpl>, isLeader: boolean, individual: boolean): void {
  const node = seat.instance
  if (node.stamp >= 0) {
    const driver = node.driver
    if (individual && node.key !== node.declaration.key && !driver.isPartition)
      console.log(`WARNING: it is recommended to assign explicit key for conditional element in order to avoid unexpected side effects: ${node.key}`)
    node.stamp = ~node.stamp
    // Deactivate element itself and remove it from collection
    const childrenAreLeaders = unobs(() => driver.destroy(node, isLeader))
    if (node.has(Mode.autonomous)) {
      // Defer disposal if element is reactive (having autonomous mode)
      seat.aux = undefined
      const last = gLastToDispose
      if (last)
        gLastToDispose = last.aux = seat
      else
        gFirstToDispose = gLastToDispose = seat
      if (gFirstToDispose === seat)
        Transaction.run({ isolation: Isolation.disjoinForInternalDisposal, hint: `runDisposalLoop(initiator=${seat.instance.key})` }, () => {
          void runDisposalLoop().then(NOP, error => console.log(error))
        })
    }
    // Deactivate children
    for (const child of node.children.items())
      triggerDeactivation(child, childrenAreLeaders, false)
    ReactiveNodeImpl.grandNodeCount--
  }
}

async function runDisposalLoop(): Promise<void> {
  await Transaction.requestNextFrame()
  let seat = gFirstToDispose
  while (seat !== undefined) {
    if (Transaction.isFrameOver(500, 5))
      await Transaction.requestNextFrame()
    ReactiveSystem.dispose(seat.instance)
    seat = seat.aux
    ReactiveNodeImpl.disposableNodeCount--
  }
  // console.log(`Element count: ${ReactiveNodeImpl.grandNodeCount} totally (${ReactiveNodeImpl.disposableNodeCount} disposable)`)
  gFirstToDispose = gLastToDispose = undefined // reset loop
}

function wrapToRunInside<T>(func: (...args: any[]) => T): (...args: any[]) => T {
  let wrappedToRunInside: (...args: any[]) => T
  const outer = gOwnSeat
  if (outer)
    wrappedToRunInside = (...args: any[]): T => {
      return runInside(outer, func, ...args)
    }
  else
    wrappedToRunInside = func
  return wrappedToRunInside
}

function runInside<T>(seat: MergedItem<ReactiveNodeImpl>, func: (...args: any[]) => T, ...args: any[]): T {
  const outer = gOwnSeat
  try {
    gOwnSeat = seat
    return func(...args)
  }
  finally {
    gOwnSeat = outer
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

let gOwnSeat: MergedItem<ReactiveNodeImpl> | undefined = undefined
let gFirstToDispose: MergedItem<ReactiveNodeImpl> | undefined = undefined
let gLastToDispose: MergedItem<ReactiveNodeImpl> | undefined = undefined
