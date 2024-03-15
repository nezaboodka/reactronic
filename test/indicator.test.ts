// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2024 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { Indicator, ObservableObject, Reentrance, RxSystem, Transaction, options, pause, raw, reactive, transaction, transactional } from "../source/api.js"
import { TestsLoggingLevel } from "./brief.js"

const expected: Array<string> = [
  "Setting compilation.",
  "Added file File1.",
  "Added file File2.",
  "Waiting for idle first time.",
  "Created source file File1.",
  "Created source file File2.",
  "Not setting compilation because transaction is cancelled.",
  "Created source file File1.",
  "Created source file File2.",
  "Setting compilation.",
  "Done waiting.",
  "File1",
  "File2",
  "Added file File3.",
  "Created source file File1.",
  "Created source file File2.",
  "Created source file File3.",
  "Setting compilation.",
  "Waiting for idle second time.",
  "Done waiting.",
  "File1",
  "File2",
  "File3",
]

export const output: string[] = []

class Compilation {
  constructor(readonly sourceFiles: readonly SourceFile[]) { }
}

class SourceFile {
  constructor(readonly text: string) { }
}

class CompilationController extends ObservableObject {
  isUpdatingFsTree = false
  @raw fsTree = new Array<SourceFile>()
  @raw compilation: Compilation | null = null

  @transactional
  add(text: string): void {
    this.isUpdatingFsTree = true
    try {
      this.fsTree.push(new SourceFile(text))
      output.push(`Added file ${text}.`)
    } finally {
      this.isUpdatingFsTree = false
    }
  }

  @reactive @options({ reentrance: Reentrance.cancelAndWaitPrevious })
  async reloadCompilation(): Promise<void> {
    if (!this.isUpdatingFsTree) {
      const sourceFiles = new Array<SourceFile>()
      for (const sourceFile of this.fsTree) {
        await pause(200)
        sourceFiles.push(sourceFile)
        output.push(`Created source file ${sourceFile.text}.`)
      }
      if (Transaction.current.isCanceled) {
        output.push(`Not setting compilation because transaction is cancelled.`)
      } else {
        output.push(`Setting compilation.`)
        this.compilation = new Compilation(sourceFiles)
      }
    }
  }
}

test("indicator", async t => {
  RxSystem.setLoggingMode(true, TestsLoggingLevel)
  // RxSystem.setProfilingMode(true)
  const indicator = Indicator.create("indicator", 0, 0, 1000)
  const controller = transaction(() => {
    const result = new CompilationController()
    RxSystem.getReaction(result.reloadCompilation).configure({ indicator })
    return result
  })
  await indicator.whenIdle()
  controller.add("File1")
  await pause(50)
  // Should cancel previous transaction.
  controller.add("File2")
  output.push('Waiting for idle first time.')
  await indicator.whenIdle()
  output.push('Done waiting.')
  // Should contain File1 and File2.
  for (const f of controller.compilation!.sourceFiles)
    output.push(f.text)
  controller.add("File3")
  // Allow transaction to finish.
  await pause(1000)
  output.push('Waiting for idle second time.')
  // Should already be full-filled.
  await indicator.whenIdle()
  output.push('Done waiting.')
  // Should contain File1, File2 and File3.
  for (const f of controller.compilation!.sourceFiles)
    output.push(f.text)

  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    t.is(output[i], expected[i])
  }
})
