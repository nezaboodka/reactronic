// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2026 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { inherit, RtDriver, RtNode, ConfOrScript } from "../source/api.js"
import { trace } from "./trace.js"

// Widget

export function Widget<E>(conf?: ConfOrScript<E>): RtNode<E> {
  return RtNode.produce(inherit(conf, {
    caption: Widget.name,
    driver: WidgetDriver.glob,
    setup(o, base) {
      trace(`${Widget.name}.setup`, base)
    },
  }))
}

// Button

export function Button<E>(conf?: ConfOrScript<E>, successor?: ConfOrScript<E>): RtNode<E> {
  return Widget<E>(inherit(conf, {
    caption: Button.name,
    setup(o, base) {
      trace(`${Button.name}.setup`, base)
    },
  }))
}

// WidgetDriver

class WidgetDriver<T> extends RtDriver<T> {
  static readonly id: string = "SampleDriver"
  static readonly glob = new WidgetDriver<any>(WidgetDriver.id, false)

  override create(_node: RtNode<T>): T {
    return {} as T
  }
}
