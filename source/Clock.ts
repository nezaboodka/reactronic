import { ObservableObject } from "./core/Mvcc.js"
import { impact } from "./ReactiveSystem.js"

export class Clock extends ObservableObject {
  hour: number = 0
  minute: number = 0
  second: number = 0
  ms: number = 0
  interval: number = 0
  paused: boolean = false

  constructor(interval: number = 1000) {
    super()
    this.interval = interval
    this.tick()
  }

  @impact
  pause(value: boolean = true): void {
    this.paused = value
  }

  @impact
  private tick(): void {
    let calibration = 0
    try {
      const now = new Date()
      this.hour = now.getHours()
      this.minute = now.getMinutes()
      this.second = now.getSeconds()
      this.ms = now.getMilliseconds()
      calibration = now.getTime() % this.interval
    }
    finally {
      setTimeout(() => this.tick(), this.interval - calibration)
    }
  }
}
