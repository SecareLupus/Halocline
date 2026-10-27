import { describe, expect, it } from 'vitest'
import { crossfadeFor, equalPowerCurves, sameAlbum, type TransitionTrack } from '../src/playback'

const track = (
  album: string | null,
  durationMs: number | null = 200_000,
  artist = 'A',
): TransitionTrack => ({
  album,
  durationMs,
  artists: [artist],
})

describe('crossfadeFor', () => {
  const on = { crossfadeMs: 6000, gaplessAlbums: true }

  it('is gapless when crossfade is off', () => {
    expect(crossfadeFor(track('X'), track('Y'), { crossfadeMs: 0, gaplessAlbums: true })).toBe(0)
  })
  it('crossfades between albums but not within one', () => {
    expect(crossfadeFor(track('X'), track('Y'), on)).toBe(6000)
    expect(crossfadeFor(track('Live at Sea'), track('live at sea '), on)).toBe(0)
    expect(crossfadeFor(track('X'), track('X'), { ...on, gaplessAlbums: false })).toBe(6000)
  })
  it('treats same-titled albums by different artists as different', () => {
    expect(sameAlbum(track('Greatest Hits', 1, 'A'), track('Greatest Hits', 1, 'B'))).toBe(false)
    expect(sameAlbum(track(null), track(null))).toBe(false)
  })
  it('caps the fade at a third of either track', () => {
    expect(crossfadeFor(track('X', 9000), track('Y'), on)).toBe(3000)
    expect(crossfadeFor(track('X'), track('Y', 3000), on)).toBe(1000)
    expect(crossfadeFor(track('X', null), track('Y', null), on)).toBe(6000)
  })
})

describe('equalPowerCurves', () => {
  it('keeps combined power constant', () => {
    const { fadeIn, fadeOut } = equalPowerCurves(16)
    expect(fadeIn[0]).toBe(0)
    expect(fadeOut[0]).toBe(1)
    for (let i = 0; i < 16; i++) expect(fadeIn[i]! ** 2 + fadeOut[i]! ** 2).toBeCloseTo(1, 5)
  })
})
