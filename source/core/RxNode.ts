// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2024 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { LoggingOptions } from "../Logging.js"
import { MergeList, MergeListReader, MergedItem } from "../util/MergeList.js"
import { emitLetters, getCallerInfo, proceed } from "../util/Utils.js"
import { Isolation, MemberOptions, Reentrance } from "../Options.js"
import { ObservableObject } from "../core/Mvcc.js"
import { Transaction } from "../core/Transaction.js"
import { RxSystem, options, raw, reactive, unobs } from "../RxSystem.js"

// Scripts

export type Script<E> = (el: E, basis: () => void) => void
export type ScriptAsync<E> = (el: E, basis: () => Promise<void>) => Promise<void>
export type Handler<E = unknown, R = void> = (el: E) => R

// Enums

export enum Mode {
  default = 0,
  independentUpdate = 1,
  manualMount = 2,
}

export enum Priority {
  realtime = 0,
  normal = 1,
  background = 2
}

// RxNode

export abstract class RxNode<E = unknown> {
  abstract readonly key: string
  abstract readonly driver: RxNodeDriver<E>
  abstract readonly declaration: Readonly<RxNodeDecl<E>/* | RxNodeDeclAsync<E>*/>
  abstract readonly level: number
  abstract readonly owner: RxNode
  abstract element: E
  abstract readonly host: RxNode
  abstract readonly children: MergeListReader<RxNode>
  abstract readonly seat: MergedItem<RxNode<E>> | undefined
  abstract readonly stamp: number
  abstract readonly outer: RxNode
  abstract readonly context: RxNodeContext | undefined
  abstract priority?: Priority
  abstract childrenShuffling: boolean
  abstract strictOrder: boolean
  abstract has(mode: Mode): boolean
  abstract configureReactronic(options: Partial<MemberOptions>): MemberOptions

  static readonly shortFrameDuration = 16 // ms
  static readonly longFrameDuration = 300 // ms
  static currentUpdatePriority = Priority.realtime
  static frameDuration = RxNode.longFrameDuration

  static declare<E = void>(
    driver: RxNodeDriver<E>,
    declaration?: RxNodeDecl<E>,
    basis?: RxNodeDecl<E>): RxNode<E> {
    let result: RxNodeImpl<E>
    // Normalize parameters
    if (declaration)
      declaration.basis = basis
    else
      declaration = basis ?? {}
    let key = declaration.key
    const owner = gOwnSeat?.instance
    if (owner) {
      let existing = owner.driver.child(owner, driver, declaration, basis)
      // Reuse existing node or declare a new one
      const children = owner.children
      existing ??= children.tryMergeAsExisting(
        key = key || generateKey(owner), undefined,
        "nested elements can be declared inside update function only")
      if (existing) {
        // Reuse existing node
        result = existing.instance as RxNodeImpl<E>
        if (result.driver !== driver && driver !== undefined)
          throw new Error(`changing element driver is not yet supported: "${result.driver.name}" -> "${driver?.name}"`)
        const exTriggers = result.declaration.triggers
        if (triggersAreEqual(declaration.triggers, exTriggers))
          declaration.triggers = exTriggers // preserve triggers instance
        result.declaration = declaration
      }
      else {
        // Create new node
        result = new RxNodeImpl<E>(key || generateKey(owner), driver, declaration, owner)
        result.seat = children.mergeAsAdded(result as RxNodeImpl<unknown>) as MergedItem<RxNodeImpl<E>>
      }
    }
    else {
      // Create new root node
      result = new RxNodeImpl(key || "", driver, declaration, owner)
      result.seat = MergeList.createItem(result)
      triggerUpdateViaSeat(result.seat)
    }
    return result
  }

  static get isFirstUpdate(): boolean {
    return RxNodeImpl.ownSeat.instance.stamp === 1
  }

  static get key(): string {
    return RxNodeImpl.ownSeat.instance.key
  }

  static get stamp(): number {
    return RxNodeImpl.ownSeat.instance.stamp
  }

  static get triggers(): unknown {
    return RxNodeImpl.ownSeat.instance.declaration.triggers
  }

  static get priority(): Priority {
    return RxNodeImpl.ownSeat.instance.priority
  }

  static set priority(value: Priority) {
    RxNodeImpl.ownSeat.instance.priority = value
  }

  static get childrenShuffling(): boolean {
    return RxNodeImpl.ownSeat.instance.childrenShuffling
  }

  static set childrenShuffling(value: boolean) {
    RxNodeImpl.ownSeat.instance.childrenShuffling = value
  }

  static triggerUpdate(node: RxNode<any>, triggers: unknown): void {
    const impl = node as RxNodeImpl<any>
    const declaration = impl.declaration
    if (!triggersAreEqual(triggers, declaration.triggers)) {
      declaration.triggers = triggers // remember new triggers
      triggerUpdateViaSeat(impl.seat!)
    }
  }

  static triggerDeactivation(node: RxNode<any>): void {
    const impl = node as RxNodeImpl<any>
    triggerDeactivation(impl.seat!, true, true)
  }

  static updateNestedNodesThenDo(action: (error: unknown) => void): void {
    runUpdateNestedNodesThenDo(undefined, action)
  }

  static markAsMounted(node: RxNode<any>, yes: boolean): void {
    const n = node as RxNodeImpl<any>
    if (n.stamp < 0)
      throw new Error("deactivated node cannot be mounted or unmounted")
    if (n.stamp >= Number.MAX_SAFE_INTEGER)
      throw new Error("node must be activated before mounting")
    n.stamp = yes ? 0 : Number.MAX_SAFE_INTEGER - 1
  }

  static findMatchingHost<E = unknown, R = unknown>(
    node: RxNode<E>, match: Handler<RxNode<E>, boolean>): RxNode<R> | undefined {
    let p = node.host as RxNodeImpl<any>
    while (p !== p.host && !match(p))
      p = p.host
    return p
  }

  static findMatchingPrevSibling<E = unknown, R = unknown>(
    node: RxNode<E>, match: Handler<RxNode<E>, boolean>): RxNode<R> | undefined {
    let p = node.seat!.prev
    while (p && !match(p.instance))
      p = p.prev
    return p?.instance as RxNode<R> | undefined
  }

  static forEachChildRecursively<E = unknown>(
    node: RxNode<E>, action: Handler<RxNode<E>>): void {
    action(node)
    for (const child of node.children.items())
      RxNode.forEachChildRecursively<E>(child.instance as RxNode<any>, action)
  }

  static getDefaultLoggingOptions(): LoggingOptions | undefined {
    return RxNodeImpl.logging
  }

  static setDefaultLoggingOptions(logging?: LoggingOptions): void {
    RxNodeImpl.logging = logging
  }
}

// RxNodeDecl & RxNodeDeclAsync

export type RxNodeDecl<E = unknown> = {
  isAsync?: boolean,
  script?: Script<E> // | ScriptAsync<E>
  key?: string
  mode?: Mode
  creation?: Script<E> // | ScriptAsync<E>
  destruction?: Script<E>
  triggers?: unknown
  basis?: RxNodeDecl<E>
}

// RxNodeDriver

export type RxNodeDriver<E = unknown> = {
  readonly name: string,
  readonly isPartition: boolean,
  readonly initialize?: Handler<E>

  allocate(node: RxNode<E>): E
  create(node: RxNode<E>): void
  destroy(node: RxNode<E>, isLeader: boolean): boolean
  mount(node: RxNode<E>): void
  update(node: RxNode<E>): void | Promise<void>
  child(ownerNode: RxNode<E>,
    childDriver: RxNodeDriver<any>,
    childDeclaration?: RxNodeDecl<any>,
    childBasis?: RxNodeDecl<any>): MergedItem<RxNode> | undefined

  getHost(node: RxNode<E>): RxNode<E>
  }

// RxNodeContext

export type RxNodeContext<T extends Object = Object> = {
  value: T
}

// BaseDriver

export abstract class BaseDriver<E = unknown> implements RxNodeDriver<E> {
  constructor(
    readonly name: string,
    readonly isPartition: boolean,
    readonly initialize?: Handler<E>) {
  }

  abstract allocate(node: RxNode<E>): E

  create(node: RxNode<E>): void | Promise<void> {
    this.initialize?.(node.element)
    return invokeCreationUsingBasisChain(node.element, node.declaration)
  }

  destroy(node: RxNode<E>, isLeader: boolean): boolean {
    invokeDestructionUsingBasisChain(node.element, node.declaration)
    return isLeader // treat children as deactivation leaders as well
  }

  mount(node: RxNode<E>): void {
    // nothing to do by default
  }

  update(node: RxNode<E>): void | Promise<void> {
    return invokeScriptUsingBasisChain(node.element, node.declaration)
  }

  child(ownerNode: RxNode<E>,
    childDriver: RxNodeDriver<any>,
    childDeclaration?: RxNodeDecl<any>,
    childBasis?: RxNodeDecl<any>): MergedItem<RxNode> | undefined {
    return undefined
  }

  getHost(node: RxNode<E>): RxNode<E> {
    return node
  }
}

// RxNodeVariable

export class RxNodeVariable<T extends Object = Object> {
  readonly defaultValue: T | undefined

  constructor(defaultValue?: T) {
    this.defaultValue = defaultValue
  }

  set value(value: T) {
    RxNodeImpl.setNodeVariableValue(this, value)
  }

  get value(): T {
    return RxNodeImpl.useNodeVariableValue(this)
  }

  get valueOrUndefined(): T | undefined {
    return RxNodeImpl.tryUseNodeVariableValue(this)
  }
}

// Utils

function generateKey(owner: RxNodeImpl): string {
  const n = owner.numerator++
  const lettered = emitLetters(n)
  let result: string
  if (RxSystem.isLogging)
    result = `·${getCallerInfo(lettered)}`
  else
    result = `·${lettered}`
  return result
}

function getModeUsingBasisChain(declaration?: RxNodeDecl<any>): Mode {
  return declaration?.mode ?? (declaration?.basis ? getModeUsingBasisChain(declaration?.basis) : Mode.default)
}

function invokeScriptUsingBasisChain(element: unknown, declaration: RxNodeDecl<any>): void {
  let result: void | Promise<void> = undefined
  const basis = declaration.basis
  const script = declaration.script
  if (script) {
    if (declaration.isAsync) {
      throw new Error("not implemented")
      // const scriptAsync = script as ScriptAsync<any>
      // result = scriptAsync(element, basis ? async () => await invokeScriptUsingBasisChain(element, basis) : NOP_ASYNC)
    }
    else {
      const scriptSync = script as Script<any>
      result = scriptSync(element, basis ? () => invokeScriptUsingBasisChain(element, basis) : NOP)
    }
  }
  else if (basis)
    result = invokeScriptUsingBasisChain(element, basis)
  return result
}

function invokeCreationUsingBasisChain(element: unknown, declaration: RxNodeDecl<any>): void {
  let result: void | Promise<void> = undefined
  const basis = declaration.basis
  const creation = declaration.creation
  if (creation) {
    if (declaration.isAsync) {
      throw new Error("not implemented")
      // const creationAsync = creation as ScriptAsync<any>
      // result = creationAsync(element, basis ? async () => await invokeScriptUsingBasisChain(element, basis) : NOP_ASYNC)
    }
    else {
      const creationSync = creation as Script<any>
      result = creationSync(element, basis ? () => invokeCreationUsingBasisChain(element, basis) : NOP)
    }
  }
  else if (basis)
    result = invokeCreationUsingBasisChain(element, basis)
  return result
}

function invokeDestructionUsingBasisChain(element: unknown, declaration: RxNodeDecl<any>): void {
  const basis = declaration.basis
  const destruction = declaration.destruction
  if (destruction)
    destruction(element, basis ? () => invokeDestructionUsingBasisChain(element, basis) : NOP)
  else if (basis)
    invokeDestructionUsingBasisChain(element, basis)
}

// RxNodeContextImpl

class RxNodeContextImpl<T extends Object = Object> extends ObservableObject implements RxNodeContext<T> {
  @raw next: RxNodeContextImpl<object> | undefined
  @raw variable: RxNodeVariable<T>
  value: T

  constructor(variable: RxNodeVariable<T>, value: T) {
    super()
    this.next = undefined
    this.variable = variable
    this.value = value
  }
}

// RxNodeImpl

class RxNodeImpl<E = unknown> extends RxNode<E> {
  // Static properties
  static logging: LoggingOptions | undefined = undefined
  static grandNodeCount: number = 0
  static disposableNodeCount: number = 0

  readonly key: string
  readonly driver: RxNodeDriver<E>
  declaration: RxNodeDecl<E>
  readonly level: number
  readonly owner: RxNodeImpl
  readonly element: E
  host: RxNodeImpl
  readonly children: MergeList<RxNodeImpl>
  seat: MergedItem<RxNodeImpl<E>> | undefined
  stamp: number
  outer: RxNodeImpl
  context: RxNodeContextImpl<any> | undefined
  numerator: number
  priority: Priority
  childrenShuffling: boolean

  constructor(
    key: string, driver: RxNodeDriver<E>,
    declaration: Readonly<RxNodeDecl<E>>,
    owner: RxNodeImpl | undefined) {
    super()
    const thisAsUnknown = this as RxNodeImpl<unknown>
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
    this.children = new MergeList<RxNodeImpl>(getNodeKey, true)
    this.seat = undefined
    this.stamp = Number.MAX_SAFE_INTEGER // newly created
    this.context = undefined
    this.numerator = 0
    this.priority = Priority.realtime
    this.childrenShuffling = false
    // Monitoring
    RxNodeImpl.grandNodeCount++
    if (this.has(Mode.independentUpdate))
      RxNodeImpl.disposableNodeCount++
  }

  get strictOrder(): boolean { return this.children.isStrict }
  set strictOrder(value: boolean) { this.children.isStrict = value }

  get isMoved(): boolean { return this.owner.children.isMoved(this.seat! as MergedItem<RxNodeImpl>) }

  has(mode: Mode): boolean {
    return (getModeUsingBasisChain(this.declaration) & mode) === mode
  }

  @reactive
  @options({
    reentrance: Reentrance.cancelPrevious,
    triggeringArgs: true,
    noSideEffects: false,
  })
  update(_triggers: unknown): void {
    // triggers parameter is used to enforce update by owner
    updateNow(this.seat!)
  }

  configureReactronic(options: Partial<MemberOptions>): MemberOptions {
    if (this.stamp < Number.MAX_SAFE_INTEGER - 1 || !this.has(Mode.independentUpdate))
      throw new Error("reactronic can be configured only for elements with independent update mode and only during activation")
    return RxSystem.getOperation(this.update).configure(options)
  }

  static get ownSeat(): MergedItem<RxNodeImpl> {
    if (!gOwnSeat)
      throw new Error("current element is undefined")
    return gOwnSeat
  }

  static tryUseNodeVariableValue<T extends Object>(variable: RxNodeVariable<T>): T | undefined {
    let node = RxNodeImpl.ownSeat.instance
    while (node.context?.variable !== variable && node.owner !== node)
      node = node.outer.seat!.instance
    return node.context?.value as any // TODO: to get rid of any
  }

  static useNodeVariableValue<T extends Object>(variable: RxNodeVariable<T>): T {
    const result = RxNodeImpl.tryUseNodeVariableValue(variable) ?? variable.defaultValue
    if (!result)
      throw new Error("unknown node variable")
    return result
  }

  static setNodeVariableValue<T extends Object>(variable: RxNodeVariable<T>, value: T | undefined): void {
    const node = RxNodeImpl.ownSeat.instance
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
          node.context = new RxNodeContextImpl<any>(variable, value)
      })
    }
    else if (hostCtx)
      node.outer = owner
    else
      node.outer = owner.outer
  }
}

// Internal

function getNodeKey(node: RxNode): string | undefined {
  return node.stamp >= 0 ? node.key : undefined
}

function runUpdateNestedNodesThenDo(error: unknown, action: (error: unknown) => void): void {
  const ownSeat = RxNodeImpl.ownSeat
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
        let p1: Array<MergedItem<RxNodeImpl>> | undefined = undefined
        let p2: Array<MergedItem<RxNodeImpl>> | undefined = undefined
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
}

function markToMountIfNecessary(mounting: boolean, host: RxNodeImpl,
  seat: MergedItem<RxNodeImpl>, children: MergeList<RxNodeImpl>, sequential: boolean): boolean {
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
  ownerSeat: MergedItem<RxNodeImpl>,
  allChildren: MergeList<RxNodeImpl>,
  priority1?: Array<MergedItem<RxNodeImpl>>,
  priority2?: Array<MergedItem<RxNodeImpl>>): Promise<void> {
  const stamp = ownerSeat.instance.stamp
  if (priority1)
    await updateIncrementally(ownerSeat, stamp, allChildren, priority1, Priority.normal)
  if (priority2)
    await updateIncrementally(ownerSeat, stamp, allChildren, priority2, Priority.background)
}

async function updateIncrementally(owner: MergedItem<RxNodeImpl>, stamp: number,
  allChildren: MergeList<RxNodeImpl>, items: Array<MergedItem<RxNodeImpl>>,
  priority: Priority): Promise<void> {
  await Transaction.requestNextFrame()
  const node = owner.instance
  if (!Transaction.isCanceled || !Transaction.isFrameOver(1, RxNode.shortFrameDuration / 3)) {
    let outerPriority = RxNode.currentUpdatePriority
    RxNode.currentUpdatePriority = priority
    try {
      if (node.childrenShuffling)
        shuffle(items)
      const frameDurationLimit = priority === Priority.background ? RxNode.shortFrameDuration : Infinity
      let frameDuration = Math.min(frameDurationLimit, Math.max(RxNode.frameDuration / 4, RxNode.shortFrameDuration))
      for (const child of items) {
        triggerUpdateViaSeat(child)
        if (Transaction.isFrameOver(1, frameDuration)) {
          RxNode.currentUpdatePriority = outerPriority
          await Transaction.requestNextFrame(0)
          outerPriority = RxNode.currentUpdatePriority
          RxNode.currentUpdatePriority = priority
          frameDuration = Math.min(4 * frameDuration, Math.min(frameDurationLimit, RxNode.frameDuration))
        }
        if (Transaction.isCanceled && Transaction.isFrameOver(1, RxNode.shortFrameDuration / 3))
          break
      }
    }
    finally {
      RxNode.currentUpdatePriority = outerPriority
    }
  }
}

function triggerUpdateViaSeat(seat: MergedItem<RxNodeImpl<any>>): void {
  const node = seat.instance
  if (node.stamp >= 0) { // if not deactivated yet
    if (node.has(Mode.independentUpdate)) {
      if (node.stamp === Number.MAX_SAFE_INTEGER) {
        Transaction.outside(() => {
          if (RxSystem.isLogging)
            RxSystem.setLoggingHint(node.element, node.key)
          RxSystem.getOperation(node.update).configure({
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

function mountOrRemountIfNecessary(node: RxNodeImpl): void {
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

function updateNow(seat: MergedItem<RxNodeImpl<any>>): void {
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
          result = proceed(result,
            v => { runUpdateNestedNodesThenDo(undefined, NOP); return v },
            e => { console.log(e); runUpdateNestedNodesThenDo(e ?? new Error("unknown error"), NOP) })
        }
        catch(e: unknown) {
          runUpdateNestedNodesThenDo(e, NOP)
          console.log(`Update failed: ${node.key}`)
          console.log(`${e}`)
        }
      }
    })
  }
}

function triggerDeactivation(seat: MergedItem<RxNodeImpl>, isLeader: boolean, individual: boolean): void {
  const node = seat.instance
  if (node.stamp >= 0) {
    const driver = node.driver
    if (individual && node.key !== node.declaration.key && !driver.isPartition)
      console.log(`WARNING: it is recommended to assign explicit key for conditional element in order to avoid unexpected side effects: ${node.key}`)
    node.stamp = ~node.stamp
    // Deactivate element itself and remove it from collection
    const childrenAreLeaders = unobs(() => driver.destroy(node, isLeader))
    if (node.has(Mode.independentUpdate)) {
      // Defer disposal if element is reactive (having independent update mode)
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
    RxNodeImpl.grandNodeCount--
  }
}

async function runDisposalLoop(): Promise<void> {
  await Transaction.requestNextFrame()
  let seat = gFirstToDispose
  while (seat !== undefined) {
    if (Transaction.isFrameOver(500, 5))
      await Transaction.requestNextFrame()
    RxSystem.dispose(seat.instance)
    seat = seat.aux
    RxNodeImpl.disposableNodeCount--
  }
  // console.log(`Element count: ${RxNodeImpl.grandNodeCount} totally (${RxNodeImpl.disposableNodeCount} disposable)`)
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

function runInside<T>(seat: MergedItem<RxNodeImpl>, func: (...args: any[]) => T, ...args: any[]): T {
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
// const NOP_ASYNC: any = async (...args: any[]): Promise<void> => { /* nop */ }

let gOwnSeat: MergedItem<RxNodeImpl> | undefined = undefined
let gFirstToDispose: MergedItem<RxNodeImpl> | undefined = undefined
let gLastToDispose: MergedItem<RxNodeImpl> | undefined = undefined
