import { Handle } from "./internal/z.index";
import { state, Isolation } from "./Config";
import { Reactronic } from "./Reactronic";

@state
export class Monitor {
  static global: Monitor;

  private _idle: boolean = true;
  private _volume: number = 0;
  private _running: Array<Reactronic<any>> = [];

  readonly isolation: Isolation;
  get isIdle(): boolean { return this._idle; }
  get volume(): number { return this._volume; }
  get running(): ReadonlyArray<Reactronic<any>> { return this._running; }

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
