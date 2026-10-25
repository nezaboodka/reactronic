// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2025 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Mode } from "../Enums.js"
import { Script, ScriptTask, produce, RtNode, Conf, BaseDriver, args2conf } from "./TreeNode.js"

// AbstractElement

export abstract class AbstractElement {

  static readonly driver: BaseDriver<any>

  static d<E = void>(
    setup: Script<E>,
    setupTask?: ScriptTask<E>,
    basis?: Conf<E>): RtNode<E>

  static d<E = void>(
    key: string,
    setup: Script<E>,
    setupTask?: ScriptTask<E>,
    basis?: Conf<E>): RtNode<E>

  static d<E = void>(
    mode: Mode,
    setup: Script<E>,
    setupTask?: ScriptTask<E>,
    basis?: Conf<E>): RtNode<E>

  static d<E = void>(
    key: string,
    mode: Mode,
    setup: Script<E>,
    setupTask?: ScriptTask<E>,
    basis?: Conf<E>): RtNode<E>

  static d<E = void>(
    conf?: Conf<E>,
    basis?: Conf<E>): RtNode<E>

  static d<E = void>(
    this: typeof AbstractElement,
    p1?: Script<E> | string | Mode | Conf<E>,
    p2?: Script<E> | ScriptTask<E> | Mode | Conf<E>,
    p3?: Script<E> | ScriptTask<E> | Conf<E>,
    p4?: ScriptTask<E> | Conf<E>,
    p5?: Conf<E>): RtNode<E> {
    //
    const conf = args2conf(this.name, p1, p2, p3, p4, p5)
    return this.produce<E>(conf)
  }

  protected static produce<E = void>(
    this: typeof AbstractElement,
    conf?: Conf<E>): RtNode<E> {
    //
    return produce<E>(this.name, this.driver, conf)
  }
}
