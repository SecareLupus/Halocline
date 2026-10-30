import { describe, expect, it } from 'vitest'
import {
  canvasScale,
  fitScale,
  formatText,
  progress,
  isPaused,
  isShown,
  trackKey,
  type OverlayState,
} from '../src/state'

const track = {
  id: 'r1',
  title: 'Song',
  artists: ['A', 'B'],
  album: null,
  durationMs: 200_000,
  artwork: null,
}
const playing: OverlayState = {
  playing: true,
  positionMs: 50_000,
  positionAt: 1_000,
  pausedAt: null,
  ad: false,
  current: { queueItemId: 'q1', recording: track },
}
const paused = (pausedAt: number): OverlayState => ({ ...playing, playing: false, pausedAt })
const FIVE_MINUTES = 5 * 60_000

describe('isShown', () => {
  it('hides with nothing playing and during ads', () => {
    expect(isShown(null, FIVE_MINUTES, 0)).toBe(false)
    expect(isShown({ ...playing, current: null }, FIVE_MINUTES, 0)).toBe(false)
    expect(isShown({ ...playing, ad: true }, FIVE_MINUTES, 0)).toBe(false)
  })

  it('shows a pause until it reads as stopped', () => {
    expect(isShown(playing, FIVE_MINUTES, 10 * FIVE_MINUTES)).toBe(true)
    expect(isShown(paused(0), FIVE_MINUTES, FIVE_MINUTES)).toBe(true)
    expect(isShown(paused(0), FIVE_MINUTES, FIVE_MINUTES + 1)).toBe(false)
    expect(isShown(paused(0), null, 100 * FIVE_MINUTES)).toBe(true)
  })
})

describe('isPaused', () => {
  it('holds while a stopped overlay fades out', () => {
    expect(isPaused(playing)).toBe(false)
    expect(isPaused(paused(0))).toBe(true)
    expect(isPaused({ ...paused(0), current: null })).toBe(false)
  })
})

describe('progress', () => {
  it('moves on from the last event while playing, and holds while paused', () => {
    expect(progress(playing, 1_000)).toBe(0.25)
    expect(progress(playing, 51_000)).toBe(0.5)
    expect(progress(paused(1_000), 51_000)).toBe(0.25)
  })

  it('stays between 0 and 1, and at 0 with no duration', () => {
    expect(progress(playing, 1_000_000)).toBe(1)
    expect(progress({ ...playing, positionAt: 100_000 }, 0)).toBe(0)
    const live = {
      ...playing,
      current: { queueItemId: 'q1', recording: { ...track, durationMs: null } },
    }
    expect(progress(live, 1_000)).toBe(0)
  })
})

describe('trackKey', () => {
  it('changes with the queue item, so a repeated song still cross-fades', () => {
    expect(trackKey(null)).toBeNull()
    expect(trackKey(playing)).toBe('q1:r1')
    expect(trackKey({ ...playing, current: { queueItemId: 'q2', recording: track } })).toBe('q2:r1')
  })
})

describe('formatText', () => {
  it('fills the known fields and leaves the rest', () => {
    expect(formatText('{artists} — {title}', track)).toBe('A, B — Song')
    expect(formatText('{album}', track)).toBe('')
    expect(formatText('Now playing: {title} {year}', track)).toBe('Now playing: Song {year}')
  })
})

describe('fitScale', () => {
  it('shrinks a long line to fit, but no further than the minimum', () => {
    expect(fitScale(200, 150, 0.75)).toBe(1)
    expect(fitScale(200, 250, 0.75)).toBeCloseTo(0.784)
    expect(fitScale(200, 400, 0.75)).toBe(0.75)
  })
})

describe('canvasScale', () => {
  it('fits the canvas into the source, keeping its shape', () => {
    const canvas = { width: 375, height: 140 }
    expect(canvasScale({ width: 375, height: 140 }, canvas)).toBe(1)
    expect(canvasScale({ width: 750, height: 280 }, canvas)).toBe(2)
    expect(canvasScale({ width: 750, height: 140 }, canvas)).toBe(1)
  })
})
