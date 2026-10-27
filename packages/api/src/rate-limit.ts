import type { MiddlewareHandler } from 'hono'
import type { ApiEnv } from './auth'
import { problem } from './problem'

interface Bucket {
  tokens: number
  at: number
}

export interface Take {
  allowed: boolean
  remaining: number
  /** Seconds until the bucket is full again. */
  resetSeconds: number
  /** Seconds until the next request would be allowed (0 if it was). */
  retryAfterSeconds: number
}

const MAX_BUCKETS = 1000

/**
 * Token buckets, one per API token. A limit of N per minute allows a burst of
 * N, refilling smoothly at N/60 per second. In memory: limits reset on restart.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(private readonly now: () => number = Date.now) {}

  take(key: string, perMinute: number): Take {
    const now = this.now()
    const perMs = perMinute / 60_000
    const bucket = this.buckets.get(key) ?? { tokens: perMinute, at: now }
    bucket.tokens = Math.min(perMinute, bucket.tokens + (now - bucket.at) * perMs)
    bucket.at = now
    const allowed = bucket.tokens >= 1
    if (allowed) bucket.tokens -= 1
    this.buckets.delete(key) // re-insert to keep Map order least-recently-used first
    this.buckets.set(key, bucket)
    if (this.buckets.size > MAX_BUCKETS) {
      this.buckets.delete(this.buckets.keys().next().value!)
    }
    return {
      allowed,
      remaining: Math.floor(bucket.tokens),
      resetSeconds: Math.ceil((perMinute - bucket.tokens) / perMs / 1000),
      retryAfterSeconds: allowed ? 0 : Math.ceil((1 - bucket.tokens) / perMs / 1000),
    }
  }
}

/** Applies each token's own `rateLimitPerMin`, if it has one (PLAN §6). */
export function rateLimit(limiter: RateLimiter): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const token = c.get('token')
    const limit = token.rateLimitPerMin
    if (!limit) return next()
    const result = limiter.take(token.id, limit)
    const headers = {
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': String(result.remaining),
      'RateLimit-Reset': String(result.resetSeconds),
    }
    if (!result.allowed) {
      const res = problem(c, 'rate_limited', `This token allows ${limit} requests per minute`)
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
      res.headers.set('Retry-After', String(result.retryAfterSeconds))
      return res
    }
    await next()
    for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v)
  }
}
