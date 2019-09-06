
// Trace

export interface Trace {
  readonly transactions: boolean;
  readonly methods: boolean;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly changes: boolean;
  readonly subscriptions: boolean;
  readonly outdating: boolean;
  readonly gc: boolean;
  readonly silent: boolean;
}

export interface TraceHighlight {
  readonly color: number;
  readonly prefix: string;
  readonly margin: number;
}

export class Dbg implements Trace {
  readonly transactions: boolean;
  readonly methods: boolean;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly changes: boolean;
  readonly subscriptions: boolean;
  readonly outdating: boolean;
  readonly gc: boolean;
  readonly silent: boolean;
  readonly color: number;
  readonly prefix: string;
  readonly margin: number;

  constructor(existing: Trace, t: Partial<Trace>, color: number, prefix: string, margin: number) {
    this.transactions = t.transactions !== undefined ? t.transactions : existing.transactions;
    this.methods = t.methods !== undefined ? t.methods : existing.methods;
    this.reads = t.reads !== undefined ? t.reads : existing.reads;
    this.writes = t.writes !== undefined ? t.writes : existing.writes;
    this.changes = t.changes !== undefined ? t.changes : existing.changes;
    this.subscriptions = t.subscriptions !== undefined ? t.subscriptions : existing.subscriptions;
    this.outdating = t.outdating !== undefined ? t.outdating : existing.outdating;
    this.gc = t.gc !== undefined ? t.gc : existing.gc;
    this.silent = t.silent !== undefined ? t.silent : existing.silent;
    this.color = color;
    this.prefix = prefix;
    this.margin = margin;
  }

  static trace: Dbg = new Dbg({
    transactions: false, methods: false, reads: false, writes: false, changes: false,
    subscriptions: false, outdating: false, gc: false, silent: false}, {}, 37, "", 0);

  static switch(enabled: boolean, trace: Partial<Trace> | undefined, hl?: TraceHighlight): Dbg {
    const existing = Dbg.trace;
    if (enabled) {
      hl = hl || existing;
      Dbg.trace = new Dbg(existing, trace || existing, hl.color, hl.prefix, hl.margin);
    }
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
}
