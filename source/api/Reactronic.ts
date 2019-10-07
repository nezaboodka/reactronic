// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Hooks, Handle, Dbg } from '../internal/all'
import { Trace } from './Config'

export class Reactronic {
  // Options
  static get triggersAutoStartDisabled(): boolean { return Hooks.triggersAutoStartDisabled }
  static set triggersAutoStartDisabled(value: boolean) { Hooks.triggersAutoStartDisabled = value }
  static get performanceWarningThreshold(): number { return Hooks.performanceWarningThreshold }
  static set performanceWarningThreshold(value: number) { Hooks.performanceWarningThreshold = value }
  // Tracing
  static get isTraceOn(): boolean { return Dbg.isOn }
  static get trace(): Trace { return Dbg.trace }
  static setTrace(t: Trace | undefined) { Dbg.global = t || Dbg.OFF; Dbg.isOn = t !== undefined }
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Handle.setHint(obj, name) }
  static getTraceHint<T extends object>(obj: T): string | undefined { return Handle.getHint(obj) }
}
