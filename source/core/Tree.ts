// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2025 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Priority, Mode } from "../Enums.js"
import { ReactiveTreeNodeDriver, ReactiveTreeNodeDecl, Script, ScriptAsync, Handler, ReactiveTreeNode, generateKey, observablesAreEqual } from "./TreeNode.js"
import { MergeList, MergedItem } from "../util/MergeList.js"
import { LoggingOptions } from "../Logging.js"

// ReactiveTree

export class ReactiveTree {
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
        result = existing.instance as ReactiveTreeNodeImpl<E>
        if (result.driver !== driver && driver !== undefined)
          throw new Error(`changing element driver is not yet supported: "${result.driver.name}" -> "${driver?.name}"`)
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
      result = new ReactiveTreeNodeImpl(effectiveKey || "", driver, declaration, owner)
      result.slot = MergeList.createItem(result)
      triggerScriptRunViaSlot(result.slot)
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

  static get isFirstScriptRun(): boolean {
    return ReactiveTreeNodeImpl.nodeSlot.instance.stamp === 1
  }

  static get key(): string {
    return ReactiveTreeNodeImpl.nodeSlot.instance.key
  }

  static get stamp(): number {
    return ReactiveTreeNodeImpl.nodeSlot.instance.stamp
  }

  static get triggers(): unknown {
    return ReactiveTreeNodeImpl.nodeSlot.instance.declaration.triggers
  }

  static get priority(): Priority {
    return ReactiveTreeNodeImpl.nodeSlot.instance.priority
  }

  static set priority(value: Priority) {
    ReactiveTreeNodeImpl.nodeSlot.instance.priority = value
  }

  static get childrenShuffling(): boolean {
    return ReactiveTreeNodeImpl.nodeSlot.instance.childrenShuffling
  }

  static set childrenShuffling(value: boolean) {
    ReactiveTreeNodeImpl.nodeSlot.instance.childrenShuffling = value
  }

  static triggerScriptRun(node: ReactiveTreeNode<any>, triggers: unknown): void {
    const impl = node as ReactiveTreeNodeImpl<any>
    const declaration = impl.declaration
    if (!observablesAreEqual(triggers, declaration.triggers)) {
      declaration.triggers = triggers // remember new triggers
      triggerScriptRunViaSlot(impl.slot!)
    }
  }

  static triggerFinalization(node: ReactiveTreeNode<any>): void {
    const impl = node as ReactiveTreeNodeImpl<any>
    triggerFinalization(impl.slot!, true, true)
  }

  static runNestedNodeScriptsThenDo(action: (error: unknown) => void): void {
    runNestedNodeScriptsThenDoImpl(ReactiveTreeNodeImpl.nodeSlot, undefined, action)
  }

  static markAsMounted(node: ReactiveTreeNode<any>, yes: boolean): void {
    const n = node as ReactiveTreeNodeImpl<any>
    if (n.stamp < 0)
      throw new Error("deactivated node cannot be mounted or unmounted")
    if (n.stamp >= Number.MAX_SAFE_INTEGER)
      throw new Error("node must be activated before mounting")
    n.stamp = yes ? 0 : Number.MAX_SAFE_INTEGER - 1
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
      ReactiveTree.forEachChildRecursively<E>(child.instance as ReactiveTreeNode<any>, action)
  }

  static getDefaultLoggingOptions(): LoggingOptions | undefined {
    return ReactiveTreeNodeImpl.logging
  }

  static setDefaultLoggingOptions(logging?: LoggingOptions): void {
    ReactiveTreeNodeImpl.logging = logging
  }
}

declare class ReactiveTreeNodeImpl<E = unknown> extends ReactiveTreeNode<E> {
  static nodeSlot: MergedItem<ReactiveTreeNodeImpl>
  static logging: LoggingOptions | undefined
  declaration: ReactiveTreeNodeDecl<E>
  slot: MergedItem<ReactiveTreeNodeImpl<E>> | undefined
  stamp: number
  priority: Priority
  childrenShuffling: boolean
  host: ReactiveTreeNodeImpl
  outer: ReactiveTreeNodeImpl
  context: any
  owner: ReactiveTreeNodeImpl
  children: MergeList<ReactiveTreeNodeImpl>
  element: E
  level: number
  key: string
  driver: ReactiveTreeNodeDriver<E>
  strictOrder: boolean
  numerator: number
  isMoved: boolean
  script: (triggers: unknown) => void

  constructor(key: string, driver: ReactiveTreeNodeDriver<E>, declaration: Readonly<ReactiveTreeNodeDecl<E>>, owner: ReactiveTreeNodeImpl | undefined)
  has(mode: Mode): boolean
  configureReactronic(options: any): any
}

declare const gNodeSlot: MergedItem<ReactiveTreeNodeImpl> | undefined
declare function getModeUsingBasisChain(declaration?: ReactiveTreeNodeDecl<any>): Mode
declare function triggerScriptRunViaSlot(nodeSlot: MergedItem<ReactiveTreeNodeImpl<any>>): void
declare function triggerFinalization(nodeSlot: MergedItem<ReactiveTreeNodeImpl>, isLeader: boolean, individual: boolean): void
declare function runNestedNodeScriptsThenDoImpl(nodeSlot: MergedItem<ReactiveTreeNodeImpl<any>>, error: unknown, action: (error: unknown) => void): void
