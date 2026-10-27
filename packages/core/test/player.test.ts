import { afterEach, describe, expect, it } from 'vitest'
import type { Core, PlayerCommand } from '../src'
import { song, testCore } from './helpers'

let core: Core
afterEach(() => core.close())

function setup() {
  core = testCore()
  const sent: PlayerCommand[] = []
  core.player.connect((c) => sent.push(c))
  const enqueue = (title: string, kind: 'local' | 'ytm' = 'local') => {
    const rec = song(core, title)
    core.library.addSource(rec.id, { kind, locator: `${title}.${kind}` })
    return core.queue.add({ recordingId: rec.id, origin: 'user' })
  }
  const loads = () => sent.filter((c) => c.type === 'load')
  return { sent, enqueue, loads }
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
})
