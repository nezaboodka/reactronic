// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2024 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { LoggingOptions } from '../Logging.js'
import { MergeList, MergedItem } from '../util/MergeList.js'
import { emitLetters, getCallerInfo } from './RxNodeUtils.js'
import { MemberOptions, Reentrance } from '../Options.js'
import { ObservableObject } from '../core/Mvcc.js'
import { Transaction } from '../core/Transaction.js'
import { RxSystem, options, raw, reactive, unobs } from '../RxSystem.js'
import { Priority, Mode, RxNodeDecl, RxNodeDriver, SimpleDelegate, RxNode, RxNodeContext, RxElement } from './RxNode.js'

// RxTree

export class RxTree {
  static readonly shortFrameDuration = 16 // ms
  static readonly longFrameDuration = 300 // ms
  static currentUpdatePriority = Priority.Realtime
  static frameDuration = RxTree.longFrameDuration

  static declare<E extends RxElement>(
    driver: RxNodeDriver<E>,
    declaration?: RxNodeDecl<E>,
    preset?: RxNodeDecl<E>): E {
    let result: E
    // Normalize parameters
    if (declaration)
      declaration.preset = preset
    else
      declaration = preset ?? {}
    let key = declaration.key
    const owner = gCurrent?.instance
    if (owner) {
      // Lookup for existing node and check for coalescing separators
      let existing: MergedItem<RxNodeImpl> | undefined = undefined
      const children = owner.children
      // Coalesce multiple separators into single one, if any
      if (driver.isPartitionSeparator) {
        const last = children.lastMergedItem()
        if (last?.instance?.driver === driver)
          existing = last
      }
      // Reuse existing node or declare a new one
      existing ??= children.tryMergeAsExisting(key = key || generateKey(owner), undefined,
        'nested elements can be declared inside update function only')
      if (existing) {
        // Reuse existing node
        const node = existing.instance
        result = node.element
        if (node.driver !== driver && driver !== undefined)
          throw new Error(`changing element driver is not yet supported: "${node.driver.name}" -> "${driver?.name}"`)
        const exTriggers = node.declaration.triggers
        if (triggersAreEqual(declaration.triggers, exTriggers))
          declaration.triggers = exTriggers // preserve triggers instance
        node.declaration = declaration
      }
      else {
        // Create new node
        const node = new RxNodeImpl(key || generateKey(owner), driver, declaration, owner)
        node.seat = children.mergeAsAdded(node)
        result = node.element
      }
    }
    else {
      // Create new root node
      const node = new RxNodeImpl(key || '', driver, declaration, owner)
      node.seat = MergeList.createItem(node)
      result = node.element
      triggerSeatUpdate(node.seat)
    }
    return result
  }

  static get isFirstUpdate(): boolean {
    return gCurrent?.instance.stamp === 1
  }

  static get nodeStamp(): number {
    return gCurrent?.instance.stamp ?? -1
  }

  static triggerUpdate(element: RxElement, triggers: unknown): void {
    const node = element.node as RxNodeImpl
    const declaration = node.declaration
    if (!triggersAreEqual(triggers, declaration.triggers)) {
      declaration.triggers = triggers // remember new triggers
      triggerSeatUpdate(node.seat!)
    }
  }

  static updateNestedTreesThenDo(action: (error: unknown) => void): void {
    runUpdateNestedTreesThenDo(undefined, action)
  }

  static findMatchingHost<E extends RxElement, R extends RxElement>(
    node: RxNode<E>, match: SimpleDelegate<RxNode<E>, boolean>): RxNode<R> | undefined {
    let p = node.host
    while (p !== p.host && !match(p))
      p = p.host
    return p
  }

  static findMatchingPrevSibling<E extends RxElement, R extends RxElement>(
    node: RxNode<E>, match: SimpleDelegate<RxNode<E>, boolean>): RxNode<R> | undefined {
    let p = node.seat!.prev
    while (p && !match(p.instance))
      p = p.prev
    return p?.instance as RxNode<R> | undefined
  }

  static forEachChildRecursively<E extends RxElement>(
    node: RxNode<E>, action: SimpleDelegate<RxNode<E>>): void {
    action(node)
    for (const child of node.children.items())
      RxTree.forEachChildRecursively<E>(child.instance, action)
  }

  static getDefaultLoggingOptions(): LoggingOptions | undefined {
    return RxNodeImpl.logging
  }

  static setDefaultLoggingOptions(logging?: LoggingOptions): void {
    RxNodeImpl.logging = logging
  }
}

// BaseDriver

export abstract class BaseDriver<E extends RxElement> implements RxNodeDriver<E> {
  constructor(
    readonly name: string,
    readonly isPartitionSeparator: boolean,
    readonly predefine?: SimpleDelegate<E>) {
  }

  abstract allocate(node: RxNode<E>): E

  initialize(element: E): void {
    this.predefine?.(element)
    initializeViaPresetChain(element, element.node.declaration)
  }

  mount(element: E): void {
    // nothing to do by default
  }

  update(element: E): void | Promise<void> {
    updateViaPresetChain(element, element.node.declaration)
  }

  finalize(element: E, isLeader: boolean): boolean {
    finalizeViaPresetChain(element, element.node.declaration)
    return isLeader // treat children as finalization leaders as well
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

function getModeViaPresetChain(declaration?: RxNodeDecl<any>): Mode {
  return declaration?.mode ?? (declaration?.preset ? getModeViaPresetChain(declaration?.preset) : Mode.Default)
}

function initializeViaPresetChain(element: unknown, declaration: RxNodeDecl<any>): void {
  const preset = declaration.preset
  const initialize = declaration.initialize
  if (initialize)
    initialize(element, preset ? () => initializeViaPresetChain(element, preset) : NOP)
  else if (preset)
    initializeViaPresetChain(element, preset)
}

function updateViaPresetChain(element: unknown, declaration: RxNodeDecl<any>): void {
  const preset = declaration.preset
  const update = declaration.update
  if (update)
    update(element, preset ? () => updateViaPresetChain(element, preset) : NOP)
  else if (preset)
    updateViaPresetChain(element, preset)
}

function finalizeViaPresetChain(element: unknown, declaration: RxNodeDecl<any>): void {
  const preset = declaration.preset
  const finalize = declaration.finalize
  if (finalize)
    finalize(element, preset ? () => finalizeViaPresetChain(element, preset) : NOP)
  else if (preset)
    finalizeViaPresetChain(element, preset)
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

class RxNodeImpl<E extends RxElement = any> implements RxNode<E> {
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
      this.owner = owner = this
      this.outer = this
    }
    this.element = driver.allocate(this)
    this.host = this // node is unmounted
    this.children = new MergeList<RxNodeImpl>(getNodeKey, true)
    this.seat = undefined
    this.stamp = Number.MAX_SAFE_INTEGER // empty
    this.context = undefined
    this.numerator = 0
    this.priority = Priority.Realtime
    this.childrenShuffling = false
    // Monitoring
    RxNodeImpl.grandNodeCount++
    if (this.has(Mode.IndependentUpdate))
      RxNodeImpl.disposableNodeCount++
  }

  get strictOrder(): boolean { return this.children.isStrict }
  set strictOrder(value: boolean) { this.children.isStrict = value }

  get isMoved(): boolean { return this.owner.children.isMoved(this.seat!) }

  has(mode: Mode): boolean {
    return (getModeViaPresetChain(this.declaration) & mode) === mode
  }

  @reactive
  @options({
    reentrance: Reentrance.CancelPrevious,
    triggeringArgs: true,
    noSideEffects: false,
  })
  update(_triggers: unknown): void {
    // triggers parameter is used to enforce update by owner
    updateNow(this.seat!)
  }

  configureReactronic(options: Partial<MemberOptions>): MemberOptions {
    if (this.stamp < Number.MAX_SAFE_INTEGER - 1 || !this.has(Mode.IndependentUpdate))
      throw new Error('reactronic can be configured only for elements with independent update mode and only inside initialize')
    return RxSystem.getReaction(this.update).configure(options)
  }

  static get current(): MergedItem<RxNodeImpl> {
    if (!gCurrent)
      throw new Error('current element is undefined')
    return gCurrent
  }

  static tryUseNodeVariableValue<T extends Object>(variable: RxNodeVariable<T>): T | undefined {
    let node = RxNodeImpl.current.instance
    while (node.context?.variable !== variable && node.owner !== node)
      node = node.outer.seat!.instance
    return node.context?.value as any // TODO: to get rid of any
  }

  static useNodeVariableValue<T extends Object>(variable: RxNodeVariable<T>): T {
    const result = RxNodeImpl.tryUseNodeVariableValue(variable) ?? variable.defaultValue
    if (!result)
      throw new Error('unknown node variable')
    return result
  }

  static setNodeVariableValue<T extends Object>(variable: RxNodeVariable<T>, value: T | undefined): void {
    const node = RxNodeImpl.current.instance
    const owner = node.owner
    const hostCtx = unobs(() => owner.context?.value)
    if (value && value !== hostCtx) {
      if (hostCtx)
        node.outer = owner
      else
        node.outer = owner.outer
      Transaction.run({ separation: true }, () => {
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

function runUpdateNestedTreesThenDo(error: unknown, action: (error: unknown) => void): void {
  const curr = RxNodeImpl.current
  const owner = curr.instance
  const children = owner.children
  if (children.isMergeInProgress) {
    let promised: Promise<void> | undefined = undefined
    try {
      children.endMerge(error)
      // Finalize removed elements
      for (const child of children.removedItems(true))
        triggerFinalization(child, true, true)
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
          const isPart = childNode.driver.isPartitionSeparator
          const host = isPart ? owner : partition
          const p = childNode.priority ?? Priority.Realtime
          mounting = markToMountIfNecessary(
            mounting, host, child, children, sequential)
          if (p === Priority.Realtime)
            triggerSeatUpdate(child) // update synchronously
          else if (p === Priority.Normal)
            p1 = push(child, p1) // defer for P1 async update
          else
            p2 = push(child, p2) // defer for P2 async update
          if (isPart)
            partition = childNode
        }
        // Update incremental children (if any)
        if (!Transaction.isCanceled && (p1 !== undefined || p2 !== undefined))
          promised = startIncrementalUpdate(curr, children, p1, p2).then(
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
  if (node.element.native && !node.has(Mode.ManualMount)) {
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
    await updateIncrementally(ownerSeat, stamp, allChildren, priority1, Priority.Normal)
  if (priority2)
    await updateIncrementally(ownerSeat, stamp, allChildren, priority2, Priority.Background)
}

async function updateIncrementally(owner: MergedItem<RxNodeImpl>, stamp: number,
  allChildren: MergeList<RxNodeImpl>, items: Array<MergedItem<RxNodeImpl>>,
  priority: Priority): Promise<void> {
  await Transaction.requestNextFrame()
  const node = owner.instance
  if (!Transaction.isCanceled || !Transaction.isFrameOver(1, RxTree.shortFrameDuration / 3)) {
    let outerPriority = RxTree.currentUpdatePriority
    RxTree.currentUpdatePriority = priority
    try {
      if (node.childrenShuffling)
        shuffle(items)
      const frameDurationLimit = priority === Priority.Background ? RxTree.shortFrameDuration : Infinity
      let frameDuration = Math.min(frameDurationLimit, Math.max(RxTree.frameDuration / 4, RxTree.shortFrameDuration))
      for (const child of items) {
        triggerSeatUpdate(child)
        if (Transaction.isFrameOver(1, frameDuration)) {
          RxTree.currentUpdatePriority = outerPriority
          await Transaction.requestNextFrame(0)
          outerPriority = RxTree.currentUpdatePriority
          RxTree.currentUpdatePriority = priority
          frameDuration = Math.min(4 * frameDuration, Math.min(frameDurationLimit, RxTree.frameDuration))
        }
        if (Transaction.isCanceled && Transaction.isFrameOver(1, RxTree.shortFrameDuration / 3))
          break
      }
    }
    finally {
      RxTree.currentUpdatePriority = outerPriority
    }
  }
}

function triggerSeatUpdate(seat: MergedItem<RxNodeImpl>): void {
  const node = seat.instance
  if (node.stamp >= 0) { // if not finalized
    if (node.has(Mode.IndependentUpdate)) {
      if (node.stamp === Number.MAX_SAFE_INTEGER) {
        Transaction.outside(() => {
          if (RxSystem.isLogging)
            RxSystem.setLoggingHint(node.element, node.key)
          RxSystem.getReaction(node.update).configure({
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
  const element = node.element
  const driver = node.driver
  if (node.stamp === Number.MAX_SAFE_INTEGER) {
    node.stamp = Number.MAX_SAFE_INTEGER - 1 // initializing
    unobs(() => {
      driver.initialize(element)
      if (!node.has(Mode.ManualMount)) {
        node.stamp = 0 // mounting
        if (element.node.host !== element.node)
          driver.mount(element)
      }
      node.stamp = 0 // TEMPORARY
    })
  }
  else if (node.isMoved && !node.has(Mode.ManualMount) && element.node.host !== element.node)
    unobs(() => driver.mount(element))
}

function updateNow(seat: MergedItem<RxNodeImpl>): void {
  const node = seat.instance
  const el = node.element
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
          result = driver.update(el)
          if (result instanceof Promise)
            result.then(
              v => { runUpdateNestedTreesThenDo(undefined, NOP); return v },
              e => { console.log(e); runUpdateNestedTreesThenDo(e ?? new Error('unknown error'), NOP) })
          else
            runUpdateNestedTreesThenDo(undefined, NOP)
        }
        catch(e: unknown) {
          runUpdateNestedTreesThenDo(e, NOP)
          console.log(`Update failed: ${node.key}`)
          console.log(`${e}`)
        }
      }
    })
  }
}

function triggerFinalization(seat: MergedItem<RxNodeImpl>, isLeader: boolean, individual: boolean): void {
  const node = seat.instance
  const el = node.element
  if (node.stamp >= 0) {
    const driver = node.driver
    if (individual && node.key !== node.declaration.key && !driver.isPartitionSeparator)
      console.log(`WARNING: it is recommended to assign explicit key for conditional element in order to avoid unexpected side effects: ${node.key}`)
    node.stamp = ~node.stamp
    // Finalize element itself and remove it from collection
    const childrenAreLeaders = unobs(() => driver.finalize(el, isLeader))
    if (node.has(Mode.IndependentUpdate)) {
      // Defer disposal if element is reactive (having independent update mode)
      seat.aux = undefined
      const last = gLastToDispose
      if (last)
        gLastToDispose = last.aux = seat
      else
        gFirstToDispose = gLastToDispose = seat
      if (gFirstToDispose === seat)
        Transaction.run({ separation: 'disposal', hint: `runDisposalLoop(initiator=${seat.instance.key})` }, () => {
          void runDisposalLoop().then(NOP, error => console.log(error))
        })
    }
    // Finalize children
    for (const child of node.children.items())
      triggerFinalization(child, childrenAreLeaders, false)
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
  const current = gCurrent
  if (current)
    wrappedToRunInside = (...args: any[]): T => {
      return runInside(current, func, ...args)
    }
  else
    wrappedToRunInside = func
  return wrappedToRunInside
}

function runInside<T>(seat: MergedItem<RxNodeImpl>, func: (...args: any[]) => T, ...args: any[]): T {
  const outer = gCurrent
  try {
    gCurrent = seat
    return func(...args)
  }
  finally {
    gCurrent = outer
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

let gCurrent: MergedItem<RxNodeImpl> | undefined = undefined
let gFirstToDispose: MergedItem<RxNodeImpl> | undefined = undefined
let gLastToDispose: MergedItem<RxNodeImpl> | undefined = undefined
