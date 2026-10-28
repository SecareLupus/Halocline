import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCore,
  PlayerService,
  type Core,
  type PlayerCommand,
  type Source,
  type TrackStore,
} from '../src'
import { fakeYtm, song, testCore } from './helpers'

let core: Core
afterEach(() => core.close())

function setup() {
  core = testCore({ ytmPlayback: true })
  const sent: PlayerCommand[] = []
  core.player.connect((c) => sent.push(c))
  const enqueue = (title: string, kind: 'local' | 'ytm' = 'local') => {
    const rec = song(core, title)
    core.library.addSource(rec.id, { kind, locator: `${title}.${kind}` })
    return core.queue.add({ recordingId: rec.id, origin: 'user' })
  }
  const loads = () => sent.filter((c) => c.type === 'load')
  const cues = () => sent.filter((c) => c.type === 'cue')
  const lastCue = () => {
    const cue = cues().at(-1)
    return cue?.type === 'cue' ? cue.next : undefined
  }
  return { sent, enqueue, loads, cues, lastCue }
}

describe('PlayerService', () => {
  it('plays through the queue and stops at the end', () => {
    const { enqueue, loads, sent } = setup()
    enqueue('A')
    enqueue('B')
    core.player.patch({ playing: true })
    expect(core.player.get().current?.recording.title).toBe('A')
    expect(loads()[0]).toMatchObject({ engine: 'local', url: expect.stringMatching(/^track:\/\//) })
    core.player.report({ type: 'ended' })
    expect(core.player.get().current?.recording.title).toBe('B')
    core.player.report({ type: 'ended' })
    expect(core.player.get()).toMatchObject({ current: null, playing: false })
    expect(sent.at(-1)).toEqual({ type: 'stop' })
  })

  it('fails over from direct to fallback within the same track', () => {
    const { enqueue, loads } = setup()
    enqueue('Cloud', 'ytm')
    core.player.patch({ playing: true })
    core.player.report({ type: 'progress', positionMs: 42_000, playing: true })
    core.player.report({ type: 'error', message: 'SABR stall' })
    const [first, second] = loads()
    expect(first).toMatchObject({ engine: 'direct', startMs: 0 })
    expect(second).toMatchObject({
      engine: 'fallback',
      nowPlaying: { queueItemId: first?.nowPlaying.queueItemId },
    })
    expect(second?.type === 'load' && second.startMs).toBeGreaterThanOrEqual(42_000)
    expect(core.health.get()).toMatchObject({
      status: 'amber',
      direct: { lastError: 'SABR stall' },
    })
  })

  it('publishes track.changed only when the track changes', () => {
    const { enqueue } = setup()
    const types: string[] = []
    core.events.subscribe((e) => types.push(e.type))
    enqueue('A')
    core.player.patch({ playing: true })
    core.player.report({ type: 'progress', positionMs: 1000, playing: true })
    expect(types.filter((t) => t.startsWith('player.') || t.startsWith('track.'))).toEqual([
      'track.changed',
      'player.changed',
    ])
  })

  it('configures the player on connect and when settings change', () => {
    const { sent } = setup()
    expect(sent[0]).toEqual({
      type: 'configure',
      playback: { outputDeviceId: '', crossfadeMs: 0, gaplessAlbums: true },
    })
    core.settings.patch({ playback: { crossfadeMs: 4000 } })
    expect(sent.at(-1)).toMatchObject({ type: 'configure', playback: { crossfadeMs: 4000 } })
  })

  it('cues the next track, and re-cues when the queue changes', () => {
    const { enqueue, lastCue, cues } = setup()
    enqueue('A')
    const b = enqueue('B')
    core.player.patch({ playing: true })
    expect(lastCue()?.nowPlaying.queueItemId).toBe(b.id)

    const c = enqueue('C')
    core.queue.move(c.id, 'next')
    expect(lastCue()?.nowPlaying.queueItemId).toBe(c.id)
    const count = cues().length
    enqueue('D') // the head didn't change, so no new cue
    expect(cues()).toHaveLength(count)

    core.queue.clear()
    expect(lastCue()).toBeNull()
  })

  it('follows the player when it advances to the cued track', () => {
    const { enqueue, lastCue, loads } = setup()
    enqueue('A')
    const b = enqueue('B')
    enqueue('C')
    core.player.patch({ playing: true })
    const types: string[] = []
    core.events.subscribe((e) => types.push(e.type))

    core.player.report({ type: 'advanced', queueItemId: b.id })
    expect(core.player.get().current?.recording.title).toBe('B')
    expect(core.queue.list().items.map((i) => i.recording.title)).toEqual(['C'])
    expect(lastCue()?.nowPlaying.recording.title).toBe('C')
    expect(types).toContain('track.changed')
    expect(loads()).toHaveLength(1) // no reload: the player is already playing B

    core.player.report({ type: 'advanced', queueItemId: 'stale-id' })
    expect(core.player.get().current?.recording.title).toBe('B')
  })

  it('keeps playing a cued track that was removed from the queue mid-transition', () => {
    const { enqueue } = setup()
    enqueue('A')
    const b = enqueue('B')
    core.player.patch({ playing: true })
    // The cue was sent for B; the queue loses B just as the player starts it.
    core.queue.remove(b.id)
    core.player.report({ type: 'advanced', queueItemId: b.id })
    expect(core.player.get().current?.recording.title).toBe('A')
  })

  it('cues the same track on repeat-one, and re-queues on repeat-all', () => {
    const { enqueue, lastCue } = setup()
    const a = enqueue('A')
    const b = enqueue('B')
    core.player.patch({ playing: true })
    core.player.patch({ repeat: 'one' })
    expect(lastCue()?.nowPlaying.queueItemId).toBe(a.id)
    core.player.report({ type: 'advanced', queueItemId: a.id })
    expect(core.player.get().current?.queueItemId).toBe(a.id)

    core.player.patch({ repeat: 'all' })
    expect(lastCue()?.nowPlaying.queueItemId).toBe(b.id)
    core.player.report({ type: 'advanced', queueItemId: b.id })
    expect(core.queue.list().items.map((i) => i.recording.title)).toEqual(['A'])
  })

  it('stores and publishes the output device state', () => {
    setup()
    const state = {
      devices: [{ deviceId: 'abc', label: 'Virtual sink' }],
      activeDeviceId: 'abc',
      error: null,
    }
    core.player.report({ type: 'output', state })
    expect(core.player.getOutput()).toEqual(state)
  })

  it('prefetches a cued cloud track and plays it from the cache once there', () => {
    core = testCore({ ytmPlayback: true })
    const cached = new Set<string>()
    const prefetched: string[] = []
    const tracks: TrackStore = {
      isCached: (source: Source) => cached.has(source.locator),
      prefetch: (source: Source) => void prefetched.push(source.locator),
    }
    const { queue, library, settings, health, ytm, events } = core
    const player = new PlayerService(queue, library, settings, health, ytm, tracks, events)
    const sent: PlayerCommand[] = []
    player.connect((c) => sent.push(c))
    const enqueue = (title: string, kind: 'local' | 'ytm') => {
      const rec = song(core, title)
      core.library.addSource(rec.id, { kind, locator: title })
      return core.queue.add({ recordingId: rec.id, origin: 'user' })
    }

    enqueue('local-one', 'local')
    enqueue('cloudSong01', 'ytm')
    player.patch({ playing: true })
    expect(prefetched).toEqual(['cloudSong01'])
    const cue = sent.findLast((c) => c.type === 'cue')
    expect(cue?.type === 'cue' && cue.next?.engine).toBe('direct')

    cached.add('cloudSong01')
    player.report({ type: 'ended' })
    expect(player.get().current).toMatchObject({ engine: 'cache' })
  })

  it('skips untagged songs in stream-safe mode, even ones queued before it came on', () => {
    const { enqueue, loads } = setup()
    const unsafe = enqueue('Untagged')
    const safe = enqueue('Tagged')
    core.library.edit(safe.recordingId, { streamSafe: true })
    expect(core.queue.get(unsafe.id).sources).toHaveLength(1)

    core.settings.patch({ streamSafeMode: true })
    core.player.patch({ playing: true })
    expect(core.player.get().current?.recording.title).toBe('Tagged')
    expect(loads().map((l) => l.type === 'load' && l.nowPlaying.recording.title)).toEqual([
      'Tagged',
    ])
  })

  it('takes an untagged song off the air when stream-safe mode comes on', () => {
    const { enqueue } = setup()
    enqueue('Untagged')
    const safe = enqueue('Tagged')
    core.library.edit(safe.recordingId, { streamSafe: true })
    core.player.patch({ playing: true })
    expect(core.player.get().current?.recording.title).toBe('Untagged')

    core.settings.patch({ streamSafeMode: true })
    expect(core.player.get().current?.recording.title).toBe('Tagged')
    core.settings.patch({ autoplay: { enabled: false } })
    expect(core.player.get().current?.recording.title).toBe('Tagged')
  })
})

describe('shuffle and repeat', () => {
  const titles = () => core.queue.list().items.map((i) => i.recording.title)
  const playing = () => core.player.get().current?.recording.title

  it('shuffle plays a random queued song, the same one it cued', () => {
    const { enqueue, lastCue } = setup()
    for (const t of ['A', 'B', 'C', 'D']) enqueue(t)
    core.player.patch({ playing: true })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    core.player.patch({ shuffle: true })
    // The pick is made when cued and kept, so the preloaded track is the one played.
    expect(lastCue()?.nowPlaying.recording.title).toBe('D')
    random.mockReturnValue(0)
    core.player.next()
    expect(playing()).toBe('D')
    expect(titles()).toEqual(['B', 'C'])
    random.mockRestore()
  })

  it('repeat puts songs back on the end when finished or skipped, keeping their details', () => {
    const { enqueue } = setup()
    const a = enqueue('A')
    enqueue('B')
    const pin = core.library.sources(a.recordingId)[0]!.id
    core.queue.pinSource(a.id, pin)
    core.player.patch({ repeat: 'all', playing: true })
    core.player.next() // A skipped
    expect(playing()).toBe('B')
    expect(core.queue.list().items).toMatchObject([
      { recording: { title: 'A' }, pinnedSourceId: pin, origin: 'user' },
    ])
    core.player.report({ type: 'ended' }) // B finished
    expect(playing()).toBe('A')
    expect(titles()).toEqual(['B'])
  })

  it('repeat replays a lone song, but never one that fails', () => {
    const { enqueue } = setup()
    enqueue('Only')
    core.player.patch({ repeat: 'all', playing: true })
    core.player.report({ type: 'ended' })
    expect(playing()).toBe('Only')
    expect(titles()).toEqual([])

    core.player.report({ type: 'error', message: 'decode failed' })
    expect(core.player.get().current).toBeNull()
    expect(titles()).toEqual([])
  })
})

describe('volume', () => {
  it('is remembered between runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'halocline-volume-'))
    const open = () =>
      createCore({ dbPath: join(dir, 'db.sqlite'), ytm: fakeYtm(), autoplay: false })
    const first = open()
    expect(first.player.get().volume).toBe(0.8)
    first.player.patch({ volume: 0.35 })
    await first.close()
    const second = open()
    expect(second.player.get().volume).toBe(0.35)
    await second.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('keeping the engine on Now Playing', () => {
  afterEach(() => vi.useRealTimers())
  const loadsOf = (sent: PlayerCommand[]) =>
    sent.flatMap((c) => (c.type === 'load' ? [c.nowPlaying.recording.title] : []))

  it('puts an engine that drifted back on Now Playing, after reports in flight', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { enqueue, sent } = setup()
    enqueue('A')
    const b = enqueue('B')
    core.player.patch({ playing: true })
    // A report already on its way when the track changed: left alone.
    core.player.report({ type: 'progress', positionMs: 5000, playing: true, queueItemId: b.id })
    expect(loadsOf(sent)).toEqual(['A'])
    // Still out of step a few seconds later: reloaded at Now Playing's position.
    vi.setSystemTime(Date.now() + 5000)
    core.player.report({ type: 'progress', positionMs: 5000, playing: true, queueItemId: b.id })
    expect(loadsOf(sent)).toEqual(['A', 'A'])
    expect(sent.filter((c) => c.type === 'load').at(-1)).toMatchObject({
      startMs: expect.any(Number),
      play: true,
    })
    expect(core.player.get().current?.recording.title).toBe('A')
  })

  it("follows an engine that moved on to a queued song it wasn't cued for", () => {
    const { enqueue } = setup()
    enqueue('A')
    enqueue('B')
    const c = enqueue('C')
    core.player.patch({ playing: true })
    core.player.report({ type: 'advanced', queueItemId: c.id })
    expect(core.player.get().current?.recording.title).toBe('C')
    expect(core.queue.list().items.map((i) => i.recording.title)).toEqual(['B'])
    // The same song again (a repeat-one copy) just starts over.
    core.player.report({ type: 'advanced', queueItemId: c.id })
    expect(core.player.get()).toMatchObject({ current: { recording: { title: 'C' } } })
  })
})
