import { Trace } from '../Trace';

// Dbg

export interface TraceDecor {
  readonly color: number;
  readonly prefix: string;
  readonly margin: number;
}

export class Dbg implements Trace, TraceDecor {
  readonly silent: boolean;
  readonly hints: boolean;
  readonly transactions: boolean;
  readonly methods: boolean;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly changes: boolean;
  readonly subscriptions: boolean;
  readonly invalidations: boolean;
  readonly gc: boolean;
  readonly color: number;
  readonly prefix: string;
  readonly margin: number;

  constructor(existing: Trace & TraceDecor, t: Partial<Trace>, decor?: TraceDecor) {
    this.silent = t.silent !== undefined ? t.silent : existing.silent;
    this.hints = t.hints !== undefined ? t.hints : existing.hints;
    this.transactions = t.transactions !== undefined ? t.transactions : existing.transactions;
    this.methods = t.methods !== undefined ? t.methods : existing.methods;
    this.reads = t.reads !== undefined ? t.reads : existing.reads;
    this.writes = t.writes !== undefined ? t.writes : existing.writes;
    this.changes = t.changes !== undefined ? t.changes : existing.changes;
    this.subscriptions = t.subscriptions !== undefined ? t.subscriptions : existing.subscriptions;
    this.invalidations = t.invalidations !== undefined ? t.invalidations : existing.invalidations;
    this.gc = t.gc !== undefined ? t.gc : existing.gc;
    this.color = decor ? decor.color : existing.color;
    this.prefix = decor ? decor.prefix : existing.prefix;
    this.margin = decor ? decor.margin : existing.margin;
  }

  static trace: Dbg = new Dbg({
    silent: false,
    hints: false,
    transactions: false,
    methods: false,
    reads: false,
    writes: false,
    changes: false,
    subscriptions: false,
    invalidations: false,
    gc: false,
    color: 37,
    prefix: "",
    margin: 0},
    {});

  static switch(trace: Partial<Trace> | undefined, decor: TraceDecor | undefined): Dbg {
    const existing = Dbg.trace;
    Dbg.trace = new Dbg(existing, trace || existing, decor);
    return existing;
  }

  static log(operation: string, marker: string, message: string, ms: number = 0, highlight: string | undefined = undefined): void {
    const margin: string = "  ".repeat(Dbg.trace.margin);
    if (!Dbg.trace.silent) /* istanbul ignore next */
      console.log("\x1b[37m%s\x1b[0m \x1b[" + Dbg.trace.color +
        "m%s %s\x1b[0m \x1b[" + Dbg.trace.color + "m%s%s\x1b[0m \x1b[" + Dbg.trace.color + "m%s\x1b[0m%s",
        "#rt", Dbg.trace.prefix, operation, margin, marker, message,
        (highlight !== undefined ? `${highlight}` : ``) +
        (ms > 2 ? `    [ ${ms}ms ]` : ``));
  }

  static logAs(trace: Partial<Trace> | undefined, decor: TraceDecor, operation: string, marker: string, message: string, ms: number = 0, highlight: string | undefined = undefined): void {
    const restore = Dbg.switch(trace, decor);
    Dbg.log(operation, marker, message, ms, highlight);
    Dbg.trace = restore;
  }
}
