export interface BreakerOptions {
  /** Consecutive failures before the breaker opens. */
  threshold: number
  /** How long it stays open before direct streaming is tried again. */
  openMs: number
  now?: () => number
}

/**
 * Routes around a broken direct engine (PLAN §4): after `threshold` failures
 * in a row, skip straight to the fallback for `openMs`, then try direct again.
 */
export class CircuitBreaker {
  private failures = 0
  private openUntil: number | null = null
  private readonly now: () => number

  constructor(private readonly options: BreakerOptions) {
    this.now = options.now ?? Date.now
  }

  /** Whether the direct engine should be tried for the next track. */
  get allowsDirect(): boolean {
    if (this.openUntil === null) return true
    if (this.now() >= this.openUntil) {
      // Half-open: let one attempt through. A failure re-opens immediately.
      this.openUntil = null
      this.failures = this.options.threshold - 1
      return true
    }
    return false
  }

  get consecutiveFailures(): number {
    return this.failures
  }

  get openUntilMs(): number | null {
    return this.openUntil
  }

  recordSuccess(): void {
    this.failures = 0
    this.openUntil = null
  }

  recordFailure(): void {
    this.failures++
    if (this.failures >= this.options.threshold) this.openUntil = this.now() + this.options.openMs
  }
}
