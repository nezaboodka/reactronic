// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test, { ExecutionContext } from "ava"
import { runTransactional, ReactiveSystem, SxObject } from "../source/api.js"
import { TestsLoggingLevel } from "./brief.js"

class Serializable extends SxObject {
  text: string = ""
  array?: Array<Serializable> = undefined
}

test("serializing", (t: ExecutionContext<unknown>) => {
  ReactiveSystem.setLoggingMode(true, TestsLoggingLevel)
  const serializable = runTransactional(() => {
    const s1 = new Serializable()
    s1.text = "s1"
    const s2 = new Serializable()
    s2.text = "s2"
    s2.array = []
    s2.array.push(s1)
    return s2
  })
  try {
    const obj = JSON.parse(JSON.stringify(serializable))
    t.assert(Array.isArray(obj.array))
  }
  finally {
  }
})
