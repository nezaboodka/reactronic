// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { TraceOptions } from '../Trace'

export function error(message: string, dump: Error | undefined): Error {
  if (Dbg.isOn && Dbg.trace.error)
    Dbg.log('█', ' ███', message, undefined, ' *** ERROR ***', dump)
  return new Error(message)
}

export function misuse(message: string, dump?: any): Error {
  const error = new Error(message)
  Dbg.log(' ', ' ███', message, undefined, ' *** ERROR / MISUSE ***', dump ?? error)
  return error
}

export function fatal(error: Error): Error {
  Dbg.log(' ', ' ███', error.message, undefined, ' *** FATAL ***', error)
  return error
}

// Dbg

export class Dbg {
  static DefaultLevel: TraceOptions = {
    silent: false,
    error: false,
    warning: false,
    transaction: false,
    method: false,
    step: false,
    monitor: false,
    read: false,
    write: false,
    change: false,
    obsolete: false,
    gc: false,
    color: 37,
    prefix: '',
    margin1: 0,
    margin2: 0,
  }

  static isOn: boolean = false
  static global: TraceOptions = Dbg.DefaultLevel
  static get trace(): TraceOptions { return this.getMergedTraceOptions(undefined) }
  static getMergedTraceOptions = (local: Partial<TraceOptions> | undefined): TraceOptions => Dbg.global

  static setTraceMode(enabled: boolean, options?: TraceOptions): void {
    Dbg.isOn = enabled
    Dbg.global = options || Dbg.DefaultLevel
    if (enabled) {
      const t = Dbg.global as any
      const o = Object.keys(Dbg.global).filter(x => t[x] === true).join(', ')
      Dbg.log('', '', `Reactronic trace is enabled: ${o}`)
      Dbg.log('', '', 'Method-level trace can be configured with @trace decorator')
    }
    else
      Dbg.log('', '', 'Reactronic trace is disabled')
  }

  static log(bar: string, tran: string, message: string, ms: number = 0, highlight: string | undefined = undefined, dump?: any): void {
    Dbg.logAs(undefined, bar, tran, message, ms, highlight, dump)
  }

  static logAs(options: Partial<TraceOptions> | undefined, bar: string, tran: string, message: string, ms: number = 0, highlight: string | undefined = undefined, dump?: any): void {
    const t = Dbg.getMergedTraceOptions(options)
    const margin1: string = '  '.repeat(t.margin1 >= 0 ? t.margin1 : 0)
    const margin2: string = '  '.repeat(t.margin2)
    const silent = (options && options.silent !== undefined) ? options.silent : t.silent
    if (!silent) { /* istanbul ignore next */
      console.log('\x1b[37m%s\x1b[0m \x1b[' + t.color + 'm%s %s%s\x1b[0m \x1b[' + t.color + 'm%s%s\x1b[0m \x1b[' + t.color + 'm%s\x1b[0m%s',
        '', t.prefix, t.transaction ? margin1 : '', t.transaction ? bar : bar.replace(/./g, ' '), margin2, tran, message,
        (highlight !== undefined ? `${highlight}` : '') + (ms > 2 ? `    [ ${ms}ms ]` : ''))
      if (dump) /* istanbul ignore next */
        console.log(dump)
    }
  }

  static merge(t: Partial<TraceOptions> | undefined, color: number | undefined, prefix: string | undefined, existing: TraceOptions): TraceOptions {
    const result = !t ? { ...existing } : {
      silent: t.silent !== undefined ? t.silent : existing.silent,
      transaction: t.transaction !== undefined ? t.transaction : existing.transaction,
      method: t.method !== undefined ? t.method : existing.method,
      step: t.step !== undefined ? t.step : existing.step,
      monitor: t.monitor !== undefined ? t.monitor : existing.monitor,
      read: t.read !== undefined ? t.read : existing.read,
      write: t.write !== undefined ? t.write : existing.write,
      change: t.change !== undefined ? t.change : existing.change,
      obsolete: t.obsolete !== undefined ? t.obsolete : existing.obsolete,
      error: t.error !== undefined ? t.error : existing.error,
      warning: t.warning !== undefined ? t.warning : existing.warning,
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
