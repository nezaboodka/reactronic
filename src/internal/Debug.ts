
// Debug

export class Debug {
  static verbosity: number = 0; // 0 = default, 1 = off, 2 = brief, 3 = normal, 4 = noisy, 5 = crazy
  static color: number = 0;
  static prefix: string = "";
  static margin: number = 0;

  static log(operation: string, marker: string, message: string, ms: number = 0): void {
    let margin: string = "  ".repeat(Debug.margin);
    console.log("\x1b[37m%s\x1b[0m \x1b[" + Debug.color +
      "m%s %s\x1b[0m \x1b[" + Debug.color + "m%s%s\x1b[0m \x1b[" + Debug.color + "m%s\x1b[0m%s",
      "#rt", Debug.prefix, operation, margin, marker, message, ms > 2 ? `    [ ${ms}ms ]` : ``);
  }
}
