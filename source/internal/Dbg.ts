// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Trace } from '../api/Trace';

// Dbg

export class Dbg {
  static OFF: Trace = {
    silent: false,
    hints: false,
    transactions: false,
    methods: false,
    monitors: false,
    reads: false,
    writes: false,
    changes: false,
    subscriptions: false,
    invalidations: false,
    gc: false,
    color: 37,
    prefix: "",
    margin: 0,
  };

  static isOn: boolean = false;
  static global: Trace = Dbg.OFF;
  static get trace(): Trace { return this.getCurrentTrace(undefined); }
  static getCurrentTrace = (local: Partial<Trace> | undefined): Trace => Dbg.global;

  static log(operation: string, marker: string, message: string, ms: number = 0, highlight: string | undefined = undefined): void {
    Dbg.logAs(undefined, operation, marker, message, ms, highlight);
  }

  static logAs(trace: Partial<Trace> | undefined, operation: string, marker: string, message: string, ms: number = 0, highlight: string | undefined = undefined): void {
    const t = Dbg.getCurrentTrace(trace);
    const margin: string = "  ".repeat(t.margin);
    const silent = (trace && trace.silent !== undefined) ? trace.silent : t.silent;
    if (!silent) /* istanbul ignore next */
      console.log("\x1b[37m%s\x1b[0m \x1b[" + t.color +
        "m%s %s\x1b[0m \x1b[" + t.color + "m%s%s\x1b[0m \x1b[" + t.color + "m%s\x1b[0m%s",
        "#rt", t.prefix, operation, margin, marker, message,
        (highlight !== undefined ? `${highlight}` : ``) +
        (ms > 2 ? `    [ ${ms}ms ]` : ``));
  }

  static merge(t: Partial<Trace> | undefined, color: number | undefined, prefix: string | undefined, existing: Trace): Trace {
    const result = !t ? { ...existing } : {
      silent: t.silent !== undefined ? t.silent : existing.silent,
      hints: t.hints !== undefined ? t.hints : existing.hints,
      transactions: t.transactions !== undefined ? t.transactions : existing.transactions,
      methods: t.methods !== undefined ? t.methods : existing.methods,
      monitors: t.monitors !== undefined ? t.monitors : existing.monitors,
      reads: t.reads !== undefined ? t.reads : existing.reads,
      writes: t.writes !== undefined ? t.writes : existing.writes,
      changes: t.changes !== undefined ? t.changes : existing.changes,
      subscriptions: t.subscriptions !== undefined ? t.subscriptions : existing.subscriptions,
      invalidations: t.invalidations !== undefined ? t.invalidations : existing.invalidations,
      gc: t.gc !== undefined ? t.gc : existing.gc,
      color: t.color !== undefined ? t.color : existing.color,
      prefix: t.prefix !== undefined ? t.prefix : existing.prefix,
      margin: t.margin !== undefined ? t.margin : existing.margin,
    };
    if (color !== undefined)
      result.color = color;
    if (prefix !== undefined)
      result.prefix = prefix;
    return result;
  }
}
