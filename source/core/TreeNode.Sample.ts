// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2025 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Mode } from "../Enums.js"
import { describe, ReactiveTreeNode, ReactiveTreeNodeDesc, ReactiveTreeNodeDriver, Script, ScriptTask } from "./TreeNode.js"

// Sample

export function Sample<E = void>(
  caller: string,
  driver: ReactiveTreeNodeDriver<E>,
  setup: Script<E>,
  setupTask?: ScriptTask<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  caller: string,
  driver: ReactiveTreeNodeDriver<E>,
  key: string,
  setup: Script<E>,
  setupTask?: ScriptTask<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  caller: string,
  driver: ReactiveTreeNodeDriver<E>,
  mode: Mode,
  setup: Script<E>,
  setupTask?: ScriptTask<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  caller: string,
  driver: ReactiveTreeNodeDriver<E>,
  key: string,
  mode: Mode,
  setup: Script<E>,
  setupTask?: ScriptTask<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  caller: string,
  driver: ReactiveTreeNodeDriver<E>,
  description?: ReactiveTreeNodeDesc<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  caller: string,
  driver: ReactiveTreeNodeDriver<E>,
  p1?: Script<E> | string | Mode | ReactiveTreeNodeDesc<E>,
  p2?: Script<E> | ScriptTask<E> | Mode | ReactiveTreeNodeDesc<E>,
  p3?: Script<E> | ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p4?: ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p5?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E> {
  return describe(caller, driver, p1, p2, p3, p4, p5)
}
