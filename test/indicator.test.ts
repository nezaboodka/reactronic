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
  "Setting compilation in 104",
  "Added file File1",
  "Created source file File1 in 110",
  "Setting compilation in 110",
  "Added file File2",
  "Created source file File1 in 117",
  "Created source file File2 in 117",
  "Setting compilation in 117",
  "Added file File3",
  "Created source file File1 in 124",
  "Created source file File2 in 124",
  "Created source file File3 in 124",
  "Setting compilation in 124",
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
      output.push(`Added file ${text}`)
    } finally {
      this.isUpdatingFsTree = false
    }
  }

  @reactive @options({ reentrance: Reentrance.cancelAndWaitPrevious })
  async reloadCompilation(): Promise<void> {
    if (!this.isUpdatingFsTree) {
      const sourceFiles = new Array<SourceFile>()
      // const cancellationToken = new CancellationToken()
      for (const sourceFile of this.fsTree) {
        await pause(400)
        // cancellationToken.throwIfCancelled()
        sourceFiles.push(sourceFile)
        output.push(`Created source file ${sourceFile.text} in ${Transaction.current.id}`)
      }
      if (Transaction.current.isCanceled) {
        output.push(`Not setting compilation because ${Transaction.current.id} is cancelled.`)
      } else {
        output.push(`Setting compilation in ${Transaction.current.id}`)
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
  await indicator.whenIdle()
  controller.add("File2")
  await indicator.whenIdle()
  await pause(100)
  controller.add("File3")
  await pause(3000)
  if (controller.compilation)
    for (const f of controller.compilation.sourceFiles)
      output.push(f.text)

  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (RxSystem.isLogging && RxSystem.loggingOptions.enabled) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})
