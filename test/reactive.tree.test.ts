// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2026 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test, { ExecutionContext } from "ava"
import { BaseDriver, RtSystem, RtNode, Conf, launchReactiveTree } from "../source/api.js"
import { RtElement } from "../source/core/TreeNode.AbstractElement.js"

// Sample

class SampleDriver<T> extends BaseDriver<T> {
  static readonly id: string = "SampleDriver"
  static readonly glob = new SampleDriver<any>(SampleDriver.id, false)

  override create(_node: RtNode<T>): T {
    return {} as T
  }
}

class Element extends RtElement {
  static override readonly driver = new SampleDriver<any>("sample", false)
}

class Button extends Element {
  protected static override produce<E = void>(
    this: typeof Button,
    conf?: Conf<E>): RtNode<E> {
    //
    return Element.d(conf, {
      setup(o, base) {
        base()
        // do noting
      },
    })
  }
}

test("reactive.tree", (t: ExecutionContext<unknown>) => {
  RtSystem.setLoggingMode(false)
  const root = launchReactiveTree(() => (
    Element.d(() => {
      Button.d(() => {
        // do nothing
      })
    })
  ))
  const nested = [...root.children.items()]
  t.is(root.key, "·Element·A")
  t.is(nested.length, 1)
  t.is(nested[0].key, "·Button·A")
})
