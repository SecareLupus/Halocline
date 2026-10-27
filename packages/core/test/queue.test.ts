import { afterEach, describe, expect, it } from 'vitest'
import { DomainError, type Core } from '../src'
import { song, testCore } from './helpers'

let core: Core
afterEach(() => core.close())

const titles = (c: Core) => c.queue.list().items.map((i) => i.recording.title)

describe('QueueService', () => {
  it('adds at end, next, and after a given item', () => {
    core = testCore()
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((t) => song(core, t))
    const itemA = core.queue.add({ recordingId: a!.id, origin: 'user' })
    core.queue.add({ recordingId: b!.id, origin: 'user' })
    core.queue.add({ recordingId: c!.id, origin: 'user', position: 'next' })
    core.queue.add({ recordingId: d!.id, origin: 'api', position: { after: itemA.id } })
    expect(titles(core)).toEqual(['C', 'A', 'D', 'B'])
  })

  it('moves and removes by stable id', () => {
    core = testCore()
    const items = ['A', 'B', 'C'].map((t) =>
      core.queue.add({ recordingId: song(core, t).id, origin: 'user' }),
    )
    core.queue.move(items[0]!.id, 'end')
    expect(titles(core)).toEqual(['B', 'C', 'A'])
    core.queue.move(items[0]!.id, { after: items[1]!.id })
    expect(titles(core)).toEqual(['B', 'A', 'C'])
    core.queue.remove(items[1]!.id)
    expect(titles(core)).toEqual(['A', 'C'])
  })

  it('bumps the revision and rejects stale writes', () => {
    core = testCore()
    const rec = song(core, 'A')
    expect(core.queue.revision).toBe(0)
    core.queue.add({ recordingId: rec.id, origin: 'user', expectedRevision: 0 })
    expect(core.queue.revision).toBe(1)
    expect(() =>
      core.queue.add({ recordingId: rec.id, origin: 'user', expectedRevision: 0 }),
    ).toThrow(expect.objectContaining({ type: 'revision_mismatch' }))
  })

  it('enforces stream-safe mode', () => {
    core = testCore()
    const safe = song(core, 'Safe', { streamSafe: true })
    const unsafe = song(core, 'Unsafe')
    core.settings.patch({ streamSafeMode: true })
    core.queue.add({ recordingId: safe.id, origin: 'api' })
    expect(() => core.queue.add({ recordingId: unsafe.id, origin: 'api' })).toThrow(DomainError)
    expect(titles(core)).toEqual(['Safe'])
  })

  it('takes the next item off the front', () => {
    core = testCore()
    ;['A', 'B'].forEach((t) => core.queue.add({ recordingId: song(core, t).id, origin: 'user' }))
    expect(core.queue.takeNext()?.recording.title).toBe('A')
    expect(titles(core)).toEqual(['B'])
  })
})
