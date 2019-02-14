import { Handle } from "./internal/z.index";
import { state } from "./Config";

@state
export class Indicator {
  static global: Indicator;
  private _idle: boolean = true;
  private _counter: number = 0;
  private _message: string = "";
  get isIdle(): boolean { return this._idle; }
  get counter(): number { return this._counter; }
  get message(): string { return this._message; }

  constructor(name: string) {
    Handle.setHint(this, name);
  }

  turnOn(message?: string): void {
    if (message)
      this._message = message;
    if (this._counter === 0)
      this._idle = false;
    this._counter++;
  }

  turnOff(message?: string): void {
    this._counter--;
    if (this._counter === 0)
      this._idle = true;
    if (message)
      this._message = message;
  }
}
