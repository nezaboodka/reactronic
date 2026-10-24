// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2025 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { fatal } from "../util/Dbg.js"
import { Mode } from "../Enums.js"
import { Script, ScriptTask, describe, ReactiveTreeNode, ReactiveTreeNodeDesc, BaseDriver } from "./TreeNode.js"

// Sample

export function Sample<E = void>(
  setup: Script<E>,
  setupTask?: ScriptTask<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  key: string,
  setup: Script<E>,
  setupTask?: ScriptTask<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  mode: Mode,
  setup: Script<E>,
  setupTask?: ScriptTask<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  key: string,
  mode: Mode,
  setup: Script<E>,
  setupTask?: ScriptTask<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  description?: ReactiveTreeNodeDesc<E>,
  basis?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E>

export function Sample<E = void>(
  p1?: Script<E> | string | Mode | ReactiveTreeNodeDesc<E>,
  p2?: Script<E> | ScriptTask<E> | Mode | ReactiveTreeNodeDesc<E>,
  p3?: Script<E> | ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p4?: ScriptTask<E> | ReactiveTreeNodeDesc<E>,
  p5?: ReactiveTreeNodeDesc<E>): ReactiveTreeNode<E> {
  //
  return describe<E>(Sample.name, SampleDriver.glob, p1, p2, p3, p4, p5)
}

// SampleDriver

export class SampleDriver<T> extends BaseDriver<T> {
  static readonly id: string = "SampleDriver"
  static readonly glob = new SampleDriver<any>(SampleDriver.id, false)

  override create(node: ReactiveTreeNode<T>): T {
    throw fatal(new Error("this is sample method and it should never be called"))
  }
}
