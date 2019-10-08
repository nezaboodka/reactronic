// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Dbg } from './util/Dbg'
import { Hooks, Hint } from './core/all'
import { Trace } from './Options'

export class Reactivity {
  // Options
  static get triggersAutoStartDisabled(): boolean { return Hooks.triggersAutoStartDisabled }
  static set triggersAutoStartDisabled(value: boolean) { Hooks.triggersAutoStartDisabled = value }
  static get performanceWarningThreshold(): number { return Hooks.performanceWarningThreshold }
  static set performanceWarningThreshold(value: number) { Hooks.performanceWarningThreshold = value }
  // Tracing
  static get isTraceOn(): boolean { return Dbg.isOn }
  static get trace(): Trace { return Dbg.trace }
  static setTrace(t: Trace | undefined): void { Dbg.global = t || Dbg.OFF; Dbg.isOn = t !== undefined }
  static setTraceHint<T extends object>(obj: T, name: string | undefined): void { Hint.setHint(obj, name) }
  static getTraceHint<T extends object>(obj: T): string | undefined { return Hint.getHint(obj) }
}
