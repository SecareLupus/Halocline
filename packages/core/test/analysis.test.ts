import { afterEach, describe, expect, it } from 'vitest'
import {
  AnalysisService,
  AnalyzerUnavailable,
  featureEvidence,
  keyScore,
  soundScore,
  tempoScore,
  type AudioFeatures,
  type Core,
  type Source,
} from '../src'
import { testCore } from './helpers'

let core: Core
afterEach(() => core?.close())

/** A unit vector pointing mostly along axis `i`. */
function direction(i: number, lean = 0): number[] {
  const v = Array.from({ length: 512 }, () => 0)
  v[i] = 1 - lean
  v[(i + 1) % 512] = lean
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}

const features = (overrides: Partial<AudioFeatures> = {}): AudioFeatures => ({
  bpm: 120,
  camelotKey: '8A',
  loudnessLufs: -9,
  energy: 0.7,
  embedding: direction(0),
  ...overrides,
})

function setup(cached: string[] = []) {
  core = testCore()
  const tracks = {
    isCached: (s: Pick<Source, 'kind' | 'locator'>) => cached.includes(s.locator),
    prefetch: () => {},
  }
  const analysis = new AnalysisService(core.db, core.library, core.settings, tracks, core.events)
  const local = (title: string) => {
    const r = core.library.create({ title, artists: ['A'], inLibrary: true })
    core.library.addSource(r.id, { kind: 'local', locator: `/music/${title}.flac` })
    return r
  }
  const cloud = (title: string, videoId: string) => {
    const r = core.library.create({ title, artists: ['B'], inLibrary: true })
    core.library.addSource(r.id, { kind: 'ytm', locator: videoId })
    return r
  }
  return { analysis, local, cloud }
}

describe('analysis queue', () => {
  it('analyzes local files, then cached cloud tracks, and skips uncached ones', async () => {
    const { analysis, local, cloud } = setup(['cachedcache'])
    const uncached = cloud('Uncached', 'notcachedxx')
    const cached = cloud('Cached', 'cachedcache')
    const file = local('File')
    const seen: string[] = []
    analysis.attach({
      analyze: async (source) => {
        seen.push(source.locator)
        return features({ bpm: seen.length * 100 })
      },
    })
    await analysis.kick()
    expect(seen).toEqual(['/music/File.flac', 'cachedcache'])
    expect(analysis.features([file.id, cached.id, uncached.id])).toEqual(
      new Map([
        [file.id, expect.objectContaining({ bpm: 100, camelotKey: '8A' })],
        [cached.id, expect.objectContaining({ bpm: 200 })],
      ]),
    )
    // The embedding survives the round trip through a BLOB.
    expect(analysis.features([file.id]).get(file.id)!.embedding![0]).toBeCloseTo(1, 5)
    expect(analysis.status()).toMatchObject({ analyzed: 2, failed: 0, pending: 0 })
  })

  it("marks a track that can't be read and moves on, but waits out an unavailable analyzer", async () => {
    const { analysis, local } = setup()
    const broken = local('Broken')
    const fine = local('Fine')
    let down = true
    analysis.attach({
      analyze: async (source) => {
        if (down) throw new AnalyzerUnavailable('no model')
        if (source.recordingId === broken.id) throw new Error('undecodable')
        return features()
      },
    })
    await analysis.kick()
    expect(analysis.status()).toMatchObject({ analyzed: 0, failed: 0, pending: 2 })
    expect(analysis.status().lastError).toBe('no model')

    down = false
    await analysis.kick()
    expect(analysis.status()).toMatchObject({ analyzed: 1, failed: 1, pending: 0 })
    expect(analysis.features([fine.id, broken.id]).has(broken.id)).toBe(false)
  })

  it('waits while music plays, unless told not to', async () => {
    const { analysis, local } = setup()
    local('First')
    local('Second')
    const playing = (on: boolean) =>
      core.events.publish({ type: 'player.changed', data: { ...core.player.get(), playing: on } })
    let calls = 0
    playing(true)
    analysis.attach({ analyze: async () => (calls++, features()) })
    await analysis.kick()
    expect(calls).toBe(0)
    expect(analysis.status()).toMatchObject({ pausedForPlayback: true, pending: 2 })

    core.settings.patch({ analysis: { duringPlayback: true } })
    await analysis.kick()
    expect(calls).toBe(2)
    expect(analysis.status().pausedForPlayback).toBe(false)
  })

  it('goes on when the music stops', async () => {
    const { analysis, local } = setup()
    local('Song')
    core.events.publish({ type: 'player.changed', data: { ...core.player.get(), playing: true } })
    let calls = 0
    analysis.attach({ analyze: async () => (calls++, features()) })
    await analysis.kick()
    expect(calls).toBe(0)
    core.events.publish({ type: 'player.changed', data: { ...core.player.get(), playing: false } })
    await analysis.kick()
    expect(calls).toBe(1)
  })

  it('does nothing while turned off', async () => {
    const { analysis, local } = setup()
    local('Song')
    core.settings.patch({ analysis: { enabled: false } })
    let calls = 0
    analysis.attach({ analyze: async () => (calls++, features()) })
    await analysis.kick()
    expect(calls).toBe(0)
    expect(analysis.status()).toMatchObject({ enabled: false, pending: 1 })
  })

  it('finds library songs that sound alike', () => {
    const { analysis, local } = setup()
    const near = local('Near')
    const far = local('Far')
    const unsafe = local('Unsafe near')
    analysis.save(near.id, features({ embedding: direction(0, 0.1) }), 'local')
    analysis.save(far.id, features({ embedding: direction(7) }), 'local')
    analysis.save(unsafe.id, features({ embedding: direction(0) }), 'local')
    core.library.edit(near.id, { streamSafe: true })
    core.library.edit(far.id, { streamSafe: true })

    const all = analysis.nearest(direction(0), { limit: 2 }).map((n) => n.recordingId)
    expect(all).toEqual([unsafe.id, near.id])
    const safe = analysis.nearest(direction(0), { limit: 2, streamSafe: true })
    expect(safe.map((n) => n.recordingId)).toEqual([near.id, far.id])
  })
})

describe('feature scores', () => {
  it('treats half and double time as the same tempo', () => {
    expect(tempoScore(120, 120)).toBe(1)
    expect(tempoScore(120, 60)).toBeCloseTo(1)
    expect(tempoScore(70, 140)).toBeCloseTo(1)
    expect(tempoScore(120, 124)).toBeGreaterThan(0.5)
    expect(tempoScore(120, 135)).toBe(0)
  })

  it('follows the Camelot wheel', () => {
    expect(keyScore('8A', '8A')).toBe(1)
    expect(keyScore('8A', '8B')).toBe(0.8)
    expect(keyScore('8A', '9A')).toBe(0.8)
    expect(keyScore('12A', '1A')).toBe(0.8)
    expect(keyScore('8A', '10A')).toBe(0.4)
    expect(keyScore('8A', '3B')).toBe(0)
  })

  it('scores sound from the embeddings, and only measurements both songs have', () => {
    expect(soundScore(direction(0), direction(0))).toBe(1)
    expect(soundScore(direction(0), direction(9))).toBe(0)
    const evidence = featureEvidence(features(), features({ bpm: null, camelotKey: null }))
    expect(evidence.map((e) => e.weight)).toEqual([1, 0.3, 0.1])
  })
})
