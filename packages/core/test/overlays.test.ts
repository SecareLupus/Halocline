import { afterEach, describe, expect, it } from 'vitest'
import {
  CLASSIC_OVERLAY,
  DEFAULT_OVERLAY_ID,
  DomainError,
  type Core,
  type OverlayDocument,
  type StampedEvent,
} from '../src'
import { testCore } from './helpers'

let core: Core
afterEach(() => core.close())

const wide: OverlayDocument = { ...CLASSIC_OVERLAY, canvas: { width: 600, height: 140 } }

function recordEvents() {
  const seen: StampedEvent[] = []
  core.events.subscribe((e) => {
    if (e.type.startsWith('overlay.')) seen.push(e)
  })
  return seen
}

describe('OverlayService', () => {
  it('always has the default overlay, drawn as Classic', () => {
    core = testCore()
    expect(core.overlays.list()).toMatchObject([
      { id: DEFAULT_OVERLAY_ID, name: 'Now playing', revision: 1, document: CLASSIC_OVERLAY },
    ])
  })

  it('creates overlays from Classic unless given a document, and lists the default first', () => {
    core = testCore()
    const seen = recordEvents()
    const plain = core.overlays.create({ name: 'Plain' })
    const custom = core.overlays.create({ name: 'Wide', document: wide })
    expect(plain.document).toEqual(CLASSIC_OVERLAY)
    expect(custom.document.canvas.width).toBe(600)
    expect(core.overlays.list().map((o) => o.name)).toEqual(['Now playing', 'Plain', 'Wide'])
    expect(seen.map((e) => e.type)).toEqual(['overlay.changed', 'overlay.changed'])
  })

  it('replaces the document whole and bumps the revision', () => {
    core = testCore()
    const seen = recordEvents()
    const renamed = core.overlays.update(DEFAULT_OVERLAY_ID, { name: 'Main' })
    expect(renamed).toMatchObject({ name: 'Main', revision: 2, document: CLASSIC_OVERLAY })
    const redrawn = core.overlays.update(DEFAULT_OVERLAY_ID, { document: wide }, 2)
    expect(redrawn).toMatchObject({ name: 'Main', revision: 3, document: wide })
    expect(seen.at(-1)).toMatchObject({ type: 'overlay.changed', data: redrawn })
  })

  it('refuses a stale revision, so one editor cannot overwrite another', () => {
    core = testCore()
    core.overlays.update(DEFAULT_OVERLAY_ID, { name: 'Main' })
    expect(() => core.overlays.update(DEFAULT_OVERLAY_ID, { document: wide }, 1)).toThrow(
      expect.objectContaining({ type: 'revision_mismatch', details: { revision: 2 } }),
    )
    expect(core.overlays.get(DEFAULT_OVERLAY_ID).document).toEqual(CLASSIC_OVERLAY)
  })

  it('rejects documents that do not validate', () => {
    core = testCore()
    const broken = {
      ...CLASSIC_OVERLAY,
      elements: [...CLASSIC_OVERLAY.elements, CLASSIC_OVERLAY.elements[0]!],
    }
    expect(() => core.overlays.update(DEFAULT_OVERLAY_ID, { document: broken })).toThrow()
    expect(() => core.overlays.create({ name: '' })).toThrow()
  })

  it('deletes overlays, but never the default one', () => {
    core = testCore()
    const seen = recordEvents()
    const extra = core.overlays.create({ name: 'Extra' })
    core.overlays.delete(extra.id)
    expect(seen.at(-1)).toMatchObject({ type: 'overlay.deleted', data: { id: extra.id } })
    expect(() => core.overlays.get(extra.id)).toThrow(DomainError)
    expect(() => core.overlays.delete(extra.id)).toThrow(
      expect.objectContaining({ type: 'not_found' }),
    )
    expect(() => core.overlays.delete(DEFAULT_OVERLAY_ID)).toThrow(
      expect.objectContaining({ type: 'invalid_request' }),
    )
  })
})
