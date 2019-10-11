// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Trace } from '../Trace'

export function error(message: string, cause: Error | undefined): Error {
  if (Dbg.isOn && Dbg.trace.errors) Dbg.log("█", "███", message, undefined, " *** ERROR ***")
  return new Error(message)
}

export function misuse(message: string): Error {
  Dbg.log("", "", message, undefined, " *** ERROR ***")
  return new Error(message)
}

// Dbg

export class Dbg {
  static OFF: Trace = {
    silent: false,
    errors: false,
    warnings: false,
    actions: false,
    methods: false,
    steps: false,
    status: false,
    reads: false,
    writes: false,
    changes: false,
    subscriptions: false,
    invalidations: false,
    gc: false,
    color: 37,
    prefix: "",
    margin1: 0,
    margin2: 0,
  }

  static isOn: boolean = false
  static global: Trace = Dbg.OFF
  static get trace(): Trace { return this.getCurrentTrace(undefined) }
  static getCurrentTrace = (local: Partial<Trace> | undefined): Trace => Dbg.global

  static log(operation: string, marker: string, message: string, ms: number = 0, highlight: string | undefined = undefined): void {
    Dbg.logAs(undefined, operation, marker, message, ms, highlight)
  }

  static logAs(trace: Partial<Trace> | undefined, operation: string, marker: string, message: string, ms: number = 0, highlight: string | undefined = undefined): void {
    const t = Dbg.getCurrentTrace(trace)
    const margin1: string = "  ".repeat(t.margin1 >= 0 ? t.margin1 : 0)
    const margin2: string = "  ".repeat(t.margin2)
    const silent = (trace && trace.silent !== undefined) ? trace.silent : t.silent
    if (!silent) /* istanbul ignore next */
      console.log("\x1b[37m%s\x1b[0m \x1b[" + t.color + "m%s %s%s\x1b[0m \x1b[" + t.color + "m%s%s\x1b[0m \x1b[" + t.color + "m%s\x1b[0m%s",
        "#rt", t.prefix, margin1, operation, margin2, marker, message,
        (highlight !== undefined ? `${highlight}` : ``) + (ms > 2 ? `    [ ${ms}ms ]` : ``))
  }

  static merge(t: Partial<Trace> | undefined, color: number | undefined, prefix: string | undefined, existing: Trace): Trace {
    const result = !t ? { ...existing } : {
      silent: t.silent !== undefined ? t.silent : existing.silent,
      actions: t.actions !== undefined ? t.actions : existing.actions,
      methods: t.methods !== undefined ? t.methods : existing.methods,
      steps: t.steps !== undefined ? t.steps : existing.steps,
      status: t.status !== undefined ? t.status : existing.status,
      reads: t.reads !== undefined ? t.reads : existing.reads,
      writes: t.writes !== undefined ? t.writes : existing.writes,
      changes: t.changes !== undefined ? t.changes : existing.changes,
      subscriptions: t.subscriptions !== undefined ? t.subscriptions : existing.subscriptions,
      invalidations: t.invalidations !== undefined ? t.invalidations : existing.invalidations,
      errors: t.errors !== undefined ? t.errors : existing.errors,
      warnings: t.warnings !== undefined ? t.warnings : existing.warnings,
      gc: t.gc !== undefined ? t.gc : existing.gc,
      color: t.color !== undefined ? t.color : existing.color,
      prefix: t.prefix !== undefined ? t.prefix : existing.prefix,
      margin1: t.margin1 !== undefined ? t.margin1 : existing.margin1,
      margin2: t.margin2 !== undefined ? t.margin2 : existing.margin2,
    }
    if (color !== undefined)
      result.color = color
    if (prefix !== undefined)
      result.prefix = prefix
    return result
  }
}
