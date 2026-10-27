import type { EventBus } from '../events'
import type { Health } from '../schemas'
import { CircuitBreaker } from '../stream/circuit-breaker'

const AMBER_WINDOW_MS = 10 * 60_000

/** Tracks direct-engine health for the footer dot, `GET /health` and `health.changed`. */
export class HealthService {
  readonly breaker: CircuitBreaker
  private lastError: string | null = null
  private lastFallbackAt: number | null = null

  constructor(
    private readonly events: EventBus,
    private readonly now: () => number = Date.now,
  ) {
    this.breaker = new CircuitBreaker({ threshold: 3, openMs: 30 * 60_000, now })
  }

  get(): Health {
    const open = this.breaker.openUntilMs !== null && this.breaker.openUntilMs > this.now()
    const recentFallback =
      this.lastFallbackAt !== null && this.now() - this.lastFallbackAt < AMBER_WINDOW_MS
    return {
      status: open ? 'red' : recentFallback ? 'amber' : 'green',
      direct: {
        consecutiveFailures: this.breaker.consecutiveFailures,
        breakerOpenUntil: open ? this.breaker.openUntilMs : null,
        lastError: this.lastError,
      },
      lastFallbackAt: this.lastFallbackAt,
    }
  }

  directSucceeded(): void {
    this.breaker.recordSuccess()
    this.publish()
  }

  directFailed(error: string): void {
    this.breaker.recordFailure()
    this.lastError = error
    this.publish()
  }

  fallbackUsed(): void {
    this.lastFallbackAt = this.now()
    this.publish()
  }

  private publish(): void {
    this.events.publish({ type: 'health.changed', data: this.get() })
  }
}
