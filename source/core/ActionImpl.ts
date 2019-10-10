// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { undef, F } from '../util/Utils'
import { Dbg, misuse, error } from '../util/Dbg'
import { Record, Observer, Snapshot, Hint } from './.index'
import { Action } from '../Action'
import { Trace } from '../Options'

export class ActionImpl extends Action {
  private static readonly none: ActionImpl = new ActionImpl("<none>")
  private static running: ActionImpl = ActionImpl.none
  private static inspection: boolean = false

  readonly trace?: Partial<Trace> // assigned in constructor
  readonly margin: number
  private readonly snapshot: Snapshot // assigned in constructor
  private readonly sidebyside: boolean
  private workers: number
  private sealed: boolean
  private error?: Error
  private retryAfter?: ActionImpl
  private promise?: Promise<void>
  private resolve: (value?: void) => void
  private reject: (reason: any) => void
  private readonly reaction: { action?: Action }

  constructor(hint: string, sidebyside: boolean = false, trace?: Partial<Trace>, token?: any) {
    super()
    this.trace = trace
    this.margin = ActionImpl.running ? ActionImpl.running.margin + 1 : -1
    this.snapshot = new Snapshot(hint, token)
    this.sidebyside = sidebyside
    this.workers = 0
    this.sealed = false
    this.error = undefined
    this.retryAfter = undefined
    this.promise = undefined
    this.resolve = undef
    this.reject = undef
    this.reaction = { action: undefined }
  }

  static get current(): ActionImpl { return ActionImpl.running }
  get id(): number { return this.snapshot.id }
  get hint(): string { return this.snapshot.hint }

  run<T>(func: F<T>, ...args: any[]): T {
    this.guard()
    return this.do(undefined, func, ...args)
  }

  inspect<T>(func: F<T>, ...args: any[]): T {
    const restore = ActionImpl.inspection
    try {
      ActionImpl.inspection = true
      if (Dbg.isOn && Dbg.trace.actions) Dbg.log("", "  ", `action T${this.id} (${this.hint}) is being inspected by T${ActionImpl.running.id} (${ActionImpl.running.hint})`)
      return this.do(undefined, func, ...args)
    }
    finally {
      ActionImpl.inspection = restore
    }
  }

  apply(): void {
    if (this.workers > 0)
      throw misuse("cannot apply action having active workers")
    if (this.error)
      throw misuse(`cannot apply action that is already canceled: ${this.error}`)
    this.seal() // apply immediately, because pending === 0
  }

  seal(): this { // t1.seal().whenFinished().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(ActionImpl.seal, this)
    return this
  }

  bind<T>(func: F<T>, secondary: boolean): F<T> {
    this.guard()
    const self = this
    const inspect = ActionImpl.inspection
    const enter = !secondary ? function(): void { self.workers++ } : function(): void { /* nop */ }
    const leave = function(...args: any[]): T { self.workers--; return func(...args) }
    !inspect ? self.do(undefined, enter) : self.inspect(enter)
    const fActionDo: F<T> = (...args: any[]): T => {
      return !inspect ? self.do<T>(undefined, leave, ...args) : self.inspect<T>(leave, ...args)
    }
    return fActionDo
  }

  cancel(error: Error, retryAfterOrIgnore?: ActionImpl | null): this {
    this.do(undefined, ActionImpl.seal, this, error,
      retryAfterOrIgnore === null ? ActionImpl.none : retryAfterOrIgnore)
    return this
  }

  isCanceled(): boolean {
    return this.error !== undefined
  }

  isFinished(): boolean {
    return this.sealed && this.workers === 0
  }

  async whenFinished(includingReaction: boolean): Promise<void> {
    if (!this.isFinished())
      await this.acquirePromise()
    if (includingReaction && this.reaction.action)
      await this.reaction.action.whenFinished(true)
  }

  static run<T>(hint: string, func: F<T>, ...args: any[]): T {
    return ActionImpl.runEx<T>(hint, false, false, undefined, undefined, func, ...args)
  }

  static runEx<T>(hint: string, spawn: boolean, sidebyside: boolean, trace: Partial<Trace> | undefined, token: any, func: F<T>, ...args: any[]): T {
    const a: ActionImpl = ActionImpl.acquire(hint, spawn, sidebyside, trace, token)
    const root = a !== ActionImpl.running
    a.guard()
    let result: any = a.do<T>(trace, func, ...args)
    if (root) {
      if (result instanceof Promise)
        result = ActionImpl.outside(() => {
          return a.wrapToRetry(a.postponed(result), func, ...args)
        })
      a.seal()
    }
    return result
  }

  static outside<T>(func: F<T>, ...args: any[]): T {
    const outer = ActionImpl.running
    try {
      ActionImpl.running = ActionImpl.none
      return func(...args)
    }
    finally {
      ActionImpl.running = outer
    }
  }

  // Internal

  private static acquire(hint: string, spawn: boolean, sidebyside: boolean, trace: Partial<Trace> | undefined, token: any): ActionImpl {
    return spawn || ActionImpl.running.isFinished()
      ? new ActionImpl(hint, sidebyside, trace, token)
      : ActionImpl.running
  }

  private guard(): void {
    if (this.error) // prevent from continuing canceled action
      throw error(this.error.message, this.error)
    if (this.sealed && ActionImpl.running !== this)
      throw misuse("cannot run action that is already sealed")
  }

  private async wrapToRetry<T>(p: Promise<T>, func: F<T>, ...args: any[]): Promise<T | undefined> {
    try {
      const result = await p
      return result
    }
    catch (error) {
      if (this.retryAfter !== ActionImpl.none) {
        if (this.retryAfter) {
          // if (Dbg.trace.actions) Dbg.log("", "  ", `action T${this.id} (${this.hint}) is waiting for restart`)
          await this.retryAfter.whenFinished(true)
          // if (Dbg.trace.actions) Dbg.log("", "  ", `action T${this.id} (${this.hint}) is ready for restart`)
          return ActionImpl.runEx<T>(this.hint, true, this.sidebyside, this.trace, this.snapshot.caching, func, ...args)
        }
        else
          throw error
      }
      else
        return undefined
    }
  }

  private async postponed<T>(p: Promise<T>): Promise<T> {
    const result = await p
    await this.whenFinished(false)
    return result
  }

  // Internal

  private do<T>(trace: Partial<Trace> | undefined, func: F<T>, ...args: any[]): T {
    let result: T
    const outer = ActionImpl.running
    try {
      ActionImpl.running = this
      this.workers++
      this.snapshot.acquire(outer.snapshot)
      result = func(...args)
      if (this.sealed && this.workers === 1) {
        if (!this.error)
          this.checkForConflicts() // merge with concurrent actions
        else if (!this.retryAfter)
          throw this.error
      }
    }
    catch (e) {
      if (!ActionImpl.inspection)
        this.cancel(e)
      throw e
    }
    finally { // it's critical to have no exceptions in this block
      this.workers--
      if (this.sealed && this.workers === 0) {
        this.finish()
        if (this.snapshot.triggers.length > 0)
          this.runTriggers()
      }
      ActionImpl.running = outer
    }
    return result
  }

  private runTriggers(): void {
    const hint = Dbg.isOn ? `■-■-■ TRIGGERS(${this.snapshot.triggers.length}) after T${this.id} (${this.snapshot.hint})` : /* istanbul ignore next */ "TRIGGERS"
    this.reaction.action = ActionImpl.runEx(hint, true, false, this.trace, undefined,
      ActionImpl.runTriggersFunc, this.snapshot.triggers)
  }

  private static runTriggersFunc(triggers: Observer[]): ActionImpl {
    const timestamp = ActionImpl.current.snapshot.timestamp
    triggers.map(t => t.trig(timestamp, false, false))
    return ActionImpl.current
  }

  private static seal(a: ActionImpl, error?: Error, retryAfter?: ActionImpl): void {
    if (!a.error && error) {
      a.error = error
      a.retryAfter = retryAfter
      if (Dbg.isOn && Dbg.trace.errors && retryAfter === undefined) Dbg.log("║", "███", `${error.message}`, undefined, " *** ERROR ***")
    }
    a.sealed = true
  }

  private checkForConflicts(): void {
    const conflicts = this.snapshot.rebase()
    if (conflicts)
      this.tryResolveConflicts(conflicts)
  }

  private tryResolveConflicts(conflicts: Record[]): void {
    if (!this.sidebyside) {
      this.error = this.error || error(`action T${this.id} (${this.hint}) conflicts with: ${Hint.conflicts(conflicts)}`, undefined)
      throw this.error
    } // ignore conflicts otherwise
    else if (Dbg.isOn && Dbg.trace.warnings)
      Dbg.log("║", "  · ", `conflict is ignored - action T${this.id} (${this.hint}) conflicts with: ${Hint.conflicts(conflicts)}`)
  }

  private finish(): void {
    // It's critical to have no exceptions in this block
    this.snapshot.apply(this.error)
    this.snapshot.collect()
    if (this.promise) {
      if (this.error && !this.retryAfter)
        this.reject(this.error)
      else
        this.resolve()
    }
    Object.freeze(this)
  }

  private acquirePromise(): Promise<void> {
    if (!this.promise) {
      this.promise = new Promise((resolve, reject): void => {
        this.resolve = resolve
        this.reject = reject
      })
    }
    return this.promise
  }

  private static readableSnapshot(): Snapshot {
    return ActionImpl.running.snapshot
  }

  private static writableSnapshot(): Snapshot {
    if (ActionImpl.inspection)
      throw misuse("cannot make changes during action inspection")
    return ActionImpl.running.snapshot
  }

  static _init(): void {
    Snapshot.readable = ActionImpl.readableSnapshot // override
    Snapshot.writable = ActionImpl.writableSnapshot // override
    ActionImpl.none.sealed = true
    ActionImpl.none.snapshot.apply()
    Snapshot._init()
  }
}

ActionImpl._init()
