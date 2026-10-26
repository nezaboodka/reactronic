// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2026 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { RtNode } from "../source/api.js"

export const traceLog: string[] = []
export let traceDepth = 0

export function trace(step: string, base: () => void): void {
  const node = RtNode.current
  const caption = node.conf.caption ?? "???"
  const indent = "  ".repeat(node.level + traceDepth)
  traceLog.push(`${indent}${caption}: ${step}`)
  traceDepth++
  try {
    base()
  }
  finally {
    traceDepth--
  }
  traceLog.push(`${indent}/${caption}: ${step}`)
}
