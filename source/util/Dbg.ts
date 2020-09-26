// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { LoggingOptions } from '../Logging'

export function error(message: string, dump: Error | undefined): Error {
  if (Dbg.isOn && Dbg.logging.errors)
    Dbg.log('█', ' ███', message, undefined, ' *** ERROR ***', dump)
  return new Error(message)
}

export function misuse(message: string, dump?: any): Error {
  const error = new Error(message)
  Dbg.log(' ', ' ███', message, undefined, ' *** ERROR / MISUSE ***', dump ?? error)
  return error
}

// Dbg

export class Dbg {
  static DefaultLevel: LoggingOptions = {
    silent: false,
    errors: false,
    warnings: false,
    transactions: false,
    methods: false,
    steps: false,
    monitors: false,
    reads: false,
    writes: false,
    changes: false,
    invalidations: false,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  }

  static isOn: boolean = false
  static global: LoggingOptions = Dbg.DefaultLevel
  static get logging(): LoggingOptions { return this.getMergedLoggingOptions(undefined) }
  static getMergedLoggingOptions = (local: Partial<LoggingOptions> | undefined): LoggingOptions => Dbg.global

  static setLoggingMode(enabled: boolean, options?: LoggingOptions): void {
    Dbg.isOn = enabled
    Dbg.global = options || Dbg.DefaultLevel
    if (enabled) {
      const t = Dbg.global as any
      const o = Object.keys(Dbg.global).filter(x => t[x] === true).join(', ')
      Dbg.log('', '', `Reactronic logging is enabled: ${o}`)
      Dbg.log('', '', 'Method-level logging can be configured with @logging decorator')
    }
    else
      Dbg.log('', '', 'Reactronic logging is disabled')
  }

  static log(bar: string, operation: string, message: string, ms: number = 0, highlight: string | undefined = undefined, dump?: any): void {
    Dbg.logAs(undefined, bar, operation, message, ms, highlight, dump)
  }

  static logAs(options: Partial<LoggingOptions> | undefined, bar: string, operation: string, message: string, ms: number = 0, highlight: string | undefined = undefined, dump?: any): void {
    const t = Dbg.getMergedLoggingOptions(options)
    const margin1: string = '  '.repeat(t.margin1 >= 0 ? t.margin1 : 0)
    const margin2: string = '  '.repeat(t.margin2)
    const silent = (options && options.silent !== undefined) ? options.silent : t.silent
    if (!silent) { /* istanbul ignore next */
      console.log('\x1b[37m%s\x1b[0m \x1b[' + t.color + 'm%s %s%s\x1b[0m \x1b[' + t.color + 'm%s%s\x1b[0m \x1b[' + t.color + 'm%s\x1b[0m%s',
        '', t.prefix, t.transactions ? margin1 : '', t.transactions ? bar : bar.replace(/./g, ' '), margin2, operation, message,
        (highlight !== undefined ? `${highlight}` : '') + (ms > 2 ? `    [ ${ms}ms ]` : ''))
      if (dump) /* istanbul ignore next */
        console.log(dump)
    }
  }

  static merge(t: Partial<LoggingOptions> | undefined, color: number | undefined, prefix: string | undefined, existing: LoggingOptions): LoggingOptions {
    const result = !t ? { ...existing } : {
      silent: t.silent !== undefined ? t.silent : existing.silent,
      transactions: t.transactions !== undefined ? t.transactions : existing.transactions,
      methods: t.methods !== undefined ? t.methods : existing.methods,
      steps: t.steps !== undefined ? t.steps : existing.steps,
      monitors: t.monitors !== undefined ? t.monitors : existing.monitors,
      reads: t.reads !== undefined ? t.reads : existing.reads,
      writes: t.writes !== undefined ? t.writes : existing.writes,
      changes: t.changes !== undefined ? t.changes : existing.changes,
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
