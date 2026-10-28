import { afterEach, describe, expect, it } from 'vitest'
import { createCore, pick, tagScore, type Core, type YtmSong } from '../src'
import { fakeYtm } from './helpers'

let core: Core
afterEach(() => core?.close())

const NOW = Date.parse('2026-10-28T12:00:00Z')
const HOUR = 3_600_000

const track = (videoId: string, title: string, artist: string): YtmSong => ({
  videoId,
  title,
  artists: [artist],
  album: null,
  durationMs: 200_000,
  artwork: null,
})

const SEED = track('seedseedsee', 'Seed Song', 'Seed Artist')
const A = track('aaaaaaaaaaa', 'Alpha', 'Other Artist')
const B = track('bbbbbbbbbbb', 'Bravo', 'Seed Artist')
const C = track('ccccccccccc', 'Charlie', 'Third Artist')

function setup(
  options: { radio?: YtmSong[]; down?: boolean; playback?: boolean; autoplay?: object } = {},
) {
  core = createCore({
    dbPath: ':memory:',
    ytm: fakeYtm([], {
      playback: options.playback ?? true,
      down: options.down ?? false,
      radio: { [SEED.videoId]: options.radio ?? [] },
    }),
    autoplay: { random: () => 0, now: () => NOW },
  })
  core.settings.patch({ autoplay: { adventurousness: 0, ...options.autoplay } })
  const seed = core.library.ensureYtmSong(SEED)
  core.library.markPlayed(seed.id, new Date(NOW))
  return seed
}

const queued = () => core.queue.list().items.map((i) => [i.recording.title, i.origin])

describe('autoplay', () => {
  it('tops the queue up from YTM radio, skipping the artist just heard', async () => {
    setup({ radio: [B, A, C] })
    await core.autoplay.check()
    expect(queued()).toEqual([
      ['Alpha', 'autoplay'],
      ['Charlie', 'autoplay'],
    ])
    // Short again once one is taken: one more, and still not the same artist.
    core.queue.remove(core.queue.list().items[0]!.id)
    await core.autoplay.check()
    expect(queued()).toHaveLength(2)
    expect(queued().map(([title]) => title)).not.toContain('Bravo')
  })

  it('does nothing when off, or when the queue is long enough', async () => {
    setup({ radio: [A, C], autoplay: { enabled: false } })
    await core.autoplay.check()
    expect(queued()).toEqual([])

    core.settings.patch({ autoplay: { enabled: true, minQueueLength: 1 } })
    await core.autoplay.check()
    expect(queued()).toHaveLength(1)
    await core.autoplay.check()
    expect(queued()).toHaveLength(1)
  })

  it('keeps to stream-safe library songs in stream-safe mode, ranked by the radio', async () => {
    setup({ radio: [C, A] })
    const unsafe = core.library.ensureYtmSong(C)
    core.library.edit(unsafe.id, { inLibrary: true })
    const ranked = core.library.ensureYtmSong(A)
    core.library.edit(ranked.id, { streamSafe: true })
    core.library.create({
      title: 'Unrelated',
      artists: ['Nobody'],
      streamSafe: true,
      inLibrary: true,
    })
    core.settings.patch({ streamSafeMode: true, autoplay: { minQueueLength: 1 } })

    await core.autoplay.check()
    expect(queued()).toEqual([['Alpha', 'autoplay']])
  })

  it('falls back to library songs by the same artists when YTM is down', async () => {
    setup({ down: true, autoplay: { minQueueLength: 1, artistGap: 0 } })
    core.library.create({ title: 'Stranger', artists: ['Nobody'], inLibrary: true })
    core.library.create({ title: 'Sibling', artists: ['Seed Artist'], inLibrary: true })
    await core.autoplay.check()
    expect(queued()).toEqual([['Sibling', 'autoplay']])
  })

  it('adds no cloud songs without a playback engine or in library-only mode', async () => {
    setup({ radio: [A, C], playback: false })
    await core.autoplay.check()
    expect(queued()).toEqual([])

    core.settings.patch({ autoplay: { sources: 'library' } })
    await core.autoplay.check()
    expect(queued()).toEqual([])
  })

  it('skips songs played recently unless nothing else is left', async () => {
    setup({ radio: [A, C], autoplay: { minQueueLength: 1, recentHours: 3 } })
    const recent = core.library.ensureYtmSong(A)
    core.library.markPlayed(recent.id, new Date(NOW - HOUR))
    // Seed is still the latest played.
    core.library.markPlayed(
      core.library.sourceByLocator('ytm', SEED.videoId)!.recordingId,
      new Date(NOW),
    )
    await core.autoplay.check()
    expect(queued()).toEqual([['Charlie', 'autoplay']])
  })
})

describe('ranking', () => {
  it('picks the best at no adventurousness and spreads out at full', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => ({ score: 1 - i * 0.02, i }))
    expect(pick(sorted, 0, () => 0.99)?.i).toBeLessThanOrEqual(1)
    const seen = new Set(Array.from({ length: 20 }, (_, n) => pick(sorted, 1, () => n / 20)?.i))
    expect(seen.size).toBeGreaterThan(10)
    expect(pick([], 0.5)).toBeUndefined()
  })

  it('scores tag overlap', () => {
    expect(tagScore(['Chill', 'house'], ['chill', 'HOUSE'])).toBe(1)
    expect(tagScore(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
    expect(tagScore([], ['a'])).toBe(0)
  })
})
