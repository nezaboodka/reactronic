// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2024 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from "ava"
import { Indicator, ObservableObject, Reentrance, RxSystem, Transaction, options, pause, raw, reactive, transaction, transactional } from "../source/api.js"
import { TestsLoggingLevel } from "./brief.js"

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
      console.log(`Added file ${text}`)
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
        console.log(`Created source file ${sourceFile.text} in ${Transaction.current.id}`)
      }
      if (Transaction.current.isCanceled) {
        console.log(`Not setting compilation because ${Transaction.current.id} is cancelled.`)
      } else {
        console.log(`Setting compilation in ${Transaction.current.id}`)
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
  console.log(controller.compilation)
  t.assert(true)
})
