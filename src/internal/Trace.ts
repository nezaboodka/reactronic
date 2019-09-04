
// Trace

export class Trace {
  static level: number = 0; // 0 = default, 1 = off, 2 = brief, 3 = normal, 4 = noisy, 5 = crazy
  static color: number = 0;
  static prefix: string = "";
  static margin: number = 0;

  static log(operation: string, marker: string, message: string, ms: number = 0, highlight: string | undefined = undefined): void {
    const margin: string = "  ".repeat(Trace.margin);
    if (Trace.level <= 5) /* istanbul ignore next */
      console.log("\x1b[37m%s\x1b[0m \x1b[" + Trace.color +
        "m%s %s\x1b[0m \x1b[" + Trace.color + "m%s%s\x1b[0m \x1b[" + Trace.color + "m%s\x1b[0m%s",
        "#rt", Trace.prefix, operation, margin, marker, message,
        (highlight !== undefined ? `${highlight}` : ``) +
        (ms > 2 ? `    [ ${ms}ms ]` : ``));
  }
}
