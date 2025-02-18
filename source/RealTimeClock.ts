import { ObservableObject } from "./core/Mvcc.js"
import { atomic, reactive } from "./ReactiveSystem.js"

export class RealTimeClock extends ObservableObject {
  hour: number = 0
  minute: number = 0
  second: number = 0
  ms: number = 0
  interval: number = 0
  paused: boolean = false

  constructor(interval: number = 1000) {
    super()
    this.interval = interval
    this.put(new Date())
  }

  @atomic
  pause(value: boolean = true): void {
    this.paused = value
  }

  @atomic
  private tick(): void {
    let calibration = 0
    try {
      const now = new Date()
      this.put(now)
      calibration = now.getTime() % this.interval
    }
    finally {
      setTimeout(() => this.tick(), this.interval - calibration)
    }
  }

  @reactive // one-time boot reaction
  protected activate(): void {
    this.tick()
  }

  private put(time: Date): void {
    this.hour = time.getHours()
    this.minute = time.getMinutes()
    this.second = time.getSeconds()
    this.ms = time.getMilliseconds()
  }
}
