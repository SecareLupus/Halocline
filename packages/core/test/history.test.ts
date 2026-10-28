import { afterEach, describe, expect, it } from 'vitest'
import { type Core } from '../src'
import { song, testCore } from './helpers'

let core: Core
afterEach(() => core.close())

describe('play history', () => {
  it('records each track start with its engine and how it was queued', () => {
    core = testCore()
    core.player.connect(() => {})
    for (const title of ['A', 'B']) {
      const rec = song(core, title)
      core.library.addSource(rec.id, { kind: 'local', locator: `${title}.flac` })
      core.queue.add({ recordingId: rec.id, origin: 'api', requestedBy: 'chatbot' })
    }
    core.player.patch({ playing: true })
    core.player.report({ type: 'ended' })

    const { items, nextCursor } = core.library.history()
    expect(items.map((e) => e.recording.title)).toEqual(['B', 'A'])
    expect(items[0]).toMatchObject({ engine: 'local', origin: 'api', requestedBy: 'chatbot' })
    expect(nextCursor).toBeNull()
    expect(core.library.get(items[0]!.recording.id)?.playCount).toBe(1)
  })

  it('pages back through older plays', () => {
    core = testCore()
    const rec = song(core, 'Loop')
    for (let i = 0; i < 5; i++)
      core.library.markPlayed(rec.id, new Date(Date.UTC(2026, 9, 28, 12, i)))
    const first = core.library.history({ limit: 2 })
    expect(first.items.map((e) => e.playedAt)).toEqual([
      '2026-10-28T12:04:00.000Z',
      '2026-10-28T12:03:00.000Z',
    ])
    const second = core.library.history({ limit: 2, before: first.nextCursor! })
    expect(second.items.map((e) => e.playedAt.slice(11, 16))).toEqual(['12:02', '12:01'])
    const last = core.library.history({ limit: 2, before: second.nextCursor! })
    expect(last).toMatchObject({ items: [{}], nextCursor: null })
    expect(() => core.library.history({ before: 'x' })).toThrow(
      expect.objectContaining({ type: 'invalid_request' }),
    )
  })

  it('keeps plays through a merge, and clearing keeps play counts', () => {
    core = testCore()
    const keep = song(core, 'Keep')
    const dupe = song(core, 'Dupe')
    core.library.markPlayed(dupe.id)
    core.catalog.merge(keep.id, [dupe.id])
    expect(core.library.history().items.map((e) => e.recording.id)).toEqual([keep.id])

    core.library.clearHistory()
    expect(core.library.history().items).toEqual([])
    expect(core.library.get(keep.id)?.playCount).toBe(1)
  })
})
