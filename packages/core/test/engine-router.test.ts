import { describe, expect, it } from 'vitest'
import { EngineRouter, type PlayerCommand, type PlayerReport, type TrackLoad } from '../src'

function setup() {
  const sent = { player: [] as PlayerCommand[], fallback: [] as PlayerCommand[] }
  const router = new EngineRouter({
    player: (c) => sent.player.push(c),
    fallback: (c) => sent.fallback.push(c),
  })
  return { router, sent }
}

const load = (engine: TrackLoad['engine'], startMs = 0): PlayerCommand => ({
  type: 'load',
  url: 'track://s',
  engine,
  startMs,
  play: true,
  nowPlaying: {
    queueItemId: 'q',
    sourceId: 's',
    engine,
    recording: {} as never,
    requestedBy: null,
  },
})

describe('EngineRouter', () => {
  it('hands a track to the fallback window and stops the player renderer', () => {
    const { router, sent } = setup()
    router.send(load('direct'))
    router.send({ type: 'pause' })
    expect(sent.player.map((c) => c.type)).toEqual(['load', 'pause'])

    router.send(load('fallback', 42_000))
    expect(sent.player.at(-1)).toEqual({ type: 'stop' })
    expect(sent.fallback).toEqual([load('fallback', 42_000)])
    router.send({ type: 'seek', positionMs: 1000 })
    expect(sent.fallback.at(-1)).toEqual({ type: 'seek', positionMs: 1000 })
    expect(router.activeEngine).toBe('fallback')

    router.send(load('local'))
    expect(sent.fallback.at(-1)).toEqual({ type: 'stop' })
    expect(router.activeEngine).toBe('player')
  })

  it('sends cues and settings to the player renderer, volume to both', () => {
    const { router, sent } = setup()
    router.send(load('fallback'))
    router.send({ type: 'cue', next: null })
    router.send({ type: 'volume', volume: 0.5 })
    expect(sent.player.map((c) => c.type)).toEqual(['stop', 'cue', 'volume'])
    expect(sent.fallback.map((c) => c.type)).toEqual(['load', 'volume'])
  })

  it('only listens to the active engine, except for the output device list', () => {
    const { router } = setup()
    const progress = { type: 'progress', positionMs: 1, playing: true } as const
    expect(router.accepts('player', progress)).toBe(true)
    expect(router.accepts('fallback', progress)).toBe(false)
    router.send(load('fallback'))
    expect(router.accepts('player', { type: 'ended' })).toBe(false)
    expect(router.accepts('fallback', { type: 'ad', active: true })).toBe(true)
    const output: PlayerReport = {
      type: 'output',
      state: { devices: [], activeDeviceId: '', error: null },
    }
    expect(router.accepts('player', output)).toBe(true)
    expect(router.accepts('fallback', output)).toBe(false)
  })
})
