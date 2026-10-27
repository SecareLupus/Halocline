import { describe, expect, it } from 'vitest'
import { chooseSource, CircuitBreaker, type Source } from '../src'

const src = (id: string, kind: Source['kind'], available = true): Source => ({
  id,
  recordingId: 'r',
  kind,
  locator: id,
  format: null,
  bitrate: null,
  available,
  failureCount: 0,
  lastChecked: null,
})

describe('chooseSource', () => {
  const ytm = src('ytm', 'ytm')
  const local = src('local', 'local')

  it('prefers local over cloud', () => {
    expect(chooseSource([ytm, local], { directAllowed: true })).toEqual({
      source: local,
      engine: 'local',
    })
  })
  it('honours a pinned source', () => {
    expect(chooseSource([ytm, local], { pinnedSourceId: 'ytm', directAllowed: true })?.source).toBe(
      ytm,
    )
  })
  it('uses the cache, then direct, then fallback', () => {
    expect(
      chooseSource([ytm], { isCached: (s) => s.id === 'ytm', directAllowed: true })?.engine,
    ).toBe('cache')
    expect(chooseSource([ytm], { directAllowed: true })?.engine).toBe('direct')
    expect(chooseSource([ytm], { directAllowed: false })?.engine).toBe('fallback')
  })
  it('skips unavailable sources', () => {
    expect(chooseSource([src('gone', 'local', false), ytm], { directAllowed: true })?.source).toBe(
      ytm,
    )
    expect(chooseSource([], { directAllowed: true })).toBeUndefined()
  })
})

describe('CircuitBreaker', () => {
  it('opens after 3 failures for 30 minutes, then half-opens', () => {
    let now = 0
    const breaker = new CircuitBreaker({ threshold: 3, openMs: 30 * 60_000, now: () => now })
    breaker.recordFailure()
    breaker.recordFailure()
    expect(breaker.allowsDirect).toBe(true)
    breaker.recordFailure()
    expect(breaker.allowsDirect).toBe(false)
    now = 30 * 60_000
    expect(breaker.allowsDirect).toBe(true)
    breaker.recordFailure() // the half-open attempt failed
    expect(breaker.allowsDirect).toBe(false)
    now += 30 * 60_000
    expect(breaker.allowsDirect).toBe(true)
    breaker.recordSuccess()
    expect(breaker.consecutiveFailures).toBe(0)
  })
})
