// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { LoggingOptions } from '../Logging'

export function error(message: string, dump: Error | undefined): Error {
  if (Log.isOn && Log.opt.error)
    Log.write('█', ' ███', message, undefined, ' *** ERROR ***', dump)
  return new Error(message)
}

export function misuse(message: string, dump?: any): Error {
  const error = new Error(message)
  Log.write(' ', ' ███', message, undefined, ' *** ERROR / MISUSE ***', dump ?? error)
  return error
}

export function fatal(error: Error): Error {
  Log.write(' ', ' ███', error.message, undefined, ' *** FATAL ***', error)
  return error
}

// Log

export class Log {
  static DefaultLevel: LoggingOptions = {
    enabled: true,
    error: false,
    warning: false,
    transaction: false,
    operation: false,
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
  static global: LoggingOptions = Log.DefaultLevel
  static get opt(): LoggingOptions { return this.getMergedLoggingOptions(undefined) }
  static getMergedLoggingOptions = (local: Partial<LoggingOptions> | undefined): LoggingOptions => Log.global

  static setMode(isOn: boolean, options?: LoggingOptions): void {
    Log.global = options || Log.DefaultLevel
    if (isOn) {
      const t = Log.global as any
      const o = Object.keys(Log.global).filter(x => t[x] === true).join(', ')
      Log.write('', '', `Reactronic logging is turned on: ${o}`)
      Log.write('', '', 'Member-level logging can be configured with @options({ logging: ... }) decorator')
    }
    else if (Log.isOn)
      Log.write('', '', 'Reactronic logging is turned off')
    Log.isOn = isOn
  }

  static write(bar: string, tran: string, message: string, ms: number = 0, highlight: string | undefined = undefined, dump?: any): void {
    Log.writeAs(undefined, bar, tran, message, ms, highlight, dump)
  }

  static writeAs(options: Partial<LoggingOptions> | undefined, bar: string, tran: string, message: string, ms: number = 0, highlight: string | undefined = undefined, dump?: any): void {
    const t = Log.getMergedLoggingOptions(options)
    const margin1: string = '  '.repeat(t.margin1 >= 0 ? t.margin1 : 0)
    const margin2: string = '  '.repeat(t.margin2)
    const enabled = (options && options.enabled !== undefined) ? options.enabled : t.enabled
    if (enabled) { /* istanbul ignore next */
      console.log('\x1b[37m%s\x1b[0m \x1b[' + t.color + 'm%s %s%s\x1b[0m \x1b[' + t.color + 'm%s%s\x1b[0m \x1b[' + t.color + 'm%s\x1b[0m%s',
        '', t.prefix, t.transaction ? margin1 : '', t.transaction ? bar : bar.replace(/./g, ' '), margin2, tran, message,
        (highlight !== undefined ? `${highlight}` : '') + (ms > 2 ? `    [ ${ms}ms ]` : ''))
      if (dump) /* istanbul ignore next */
        console.log(dump)
    }
  }

  static merge(t: Partial<LoggingOptions> | undefined, color: number | undefined, prefix: string | undefined, existing: LoggingOptions): LoggingOptions {
    const result = !t ? { ...existing } : {
      enabled: t.enabled !== undefined ? t.enabled : existing.enabled,
      transaction: t.transaction !== undefined ? t.transaction : existing.transaction,
      operation: t.operation !== undefined ? t.operation : existing.operation,
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
