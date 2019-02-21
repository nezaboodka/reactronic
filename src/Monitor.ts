import { Handle } from "./internal/z.index";
import { state, Isolation } from "./Config";

@state
export class Monitor {
  static global: Monitor;

  private _idle: boolean = true;
  private _volume: number = 0;

  readonly isolation: Isolation;
  get isIdle(): boolean { return this._idle; }
  get volume(): number { return this._volume; }

  constructor(name: string, isolation: Isolation = Isolation.StandaloneTransaction) {
    this.isolation = isolation;
    Handle.setHint(this, name);
  }

  enter(): void {
    if (this._volume === 0)
      this._idle = false;
    this._volume++;
  }

  leave(): void {
    this._volume--;
    if (this._volume === 0)
      this._idle = true;
  }
}
