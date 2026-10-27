// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2026 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test, { ExecutionContext } from "ava"
import { RtSystem, launchReactiveTree } from "../source/api.js"
import { Widget, Button } from "./dom.js"
import { traceLog, trace } from "./trace.js"

const expected: string[] = [
  "  ·Widget·A: () => {}",
  "    Widget.setup",
  "    /Widget.setup",
  "  /·Widget·A: () => {}",
  "    ·Button·A: () => {}",
  "      Button.setup",
  "        Widget.setup",
  "        /Widget.setup",
  "      /Button.setup",
  "    /·Button·A: () => {}",
]

test("reactive-tree", (t: ExecutionContext<unknown>) => {
  RtSystem.setLoggingMode(false)
  traceLog.length = 0
  const root = launchReactiveTree(() => (
    Widget((o, base) => {
      trace("() => {}", true, () => {
        base()
        Button((o, base) => {
          trace("() => {}", true, base)
        })
      })
    })
  ))
  const nested = [...root.children.items()]
  t.is(root.key, "·Widget·A")
  t.is(nested.length, 1)
  t.is(nested[0].key, "·Button·A")
  t.deepEqual(traceLog, expected)
})
