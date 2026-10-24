// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2025 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Mode } from "../Enums.js"
import { Script, ScriptTask, describe, ReactiveTreeNode, ReactiveTreeNodeDesc, BaseDriver, args2desc } from "./TreeNode.js"

// AbstractElement

export abstract class AbstractElement {

  static readonly driver: BaseDriver<any>

  static d<E = void>(
    setup: Script<E>,
    setupTask?: ScriptTask<E>,
    basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

  static d<E = void>(
    key: string,
    setup: Script<E>,
    setupTask?: ScriptTask<E>,
    basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

  static d<E = void>(
    mode: Mode,
    setup: Script<E>,
    setupTask?: ScriptTask<E>,
    basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

  static d<E = void>(
    key: string,
    mode: Mode,
    setup: Script<E>,
    setupTask?: ScriptTask<E>,
    basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

  static d<E = void>(
    description?: ReactiveTreeNodeDesc<E>,
    basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

  static d<E = void>(
    this: typeof AbstractElement,
    p1?: Script<E> | string | Mode | ReactiveTreeNodeDesc<E>,
    p2?: Script<E> | ScriptTask<E> | Mode | ReactiveTreeNodeDesc<E>,
    p3?: Script<E> | ScriptTask<E> | ReactiveTreeNodeDesc<E>,
    p4?: ScriptTask<E> | ReactiveTreeNodeDesc<E>,
    p5?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E> {
    //
    const description = args2desc(this.name, p1, p2, p3, p4, p5)
    return this.describe<E>(description)
  }

  protected static describe<E = void>(
    this: typeof AbstractElement,
    description?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E> {
    //
    return describe<E>(this.name, this.driver, description)
  }
}
