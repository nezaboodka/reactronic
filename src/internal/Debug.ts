
// Debug

export class Debug {
  static verbosity: number = 0; // 0 = off, 1 = brief, 2 = normal, 3 = noisy, 4 = crazy
  static color: number = 0;
  static prefix: string = "";
  static margin: number = 0;

  static log(operation: string, marker: string, message: string): void {
    let margin: string = ""; // "    ".repeat(Debug.margin);
    console.log("\x1b[37m%s\x1b[0m \x1b[" + Debug.color +
      "m%s %s\x1b[0m \x1b[" + Debug.color + "m%s%s\x1b[0m \x1b[" + Debug.color + "m%s\x1b[0m",
      "#rt", Debug.prefix, operation, margin, marker, message);
  }
}
