import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CLASSIC_OVERLAY,
  createCore,
  CLASSIC_OVERLAY_ID,
  DomainError,
  OverlayDocument,
  OverlayService,
  type Core,
  type StampedEvent,
} from '../src'
import { fakeYtm, testCore } from './helpers'

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
  it('starts with Classic', () => {
    core = testCore()
    expect(core.overlays.list()).toMatchObject([
      { id: CLASSIC_OVERLAY_ID, name: 'Classic', revision: 1, document: CLASSIC_OVERLAY },
    ])
  })

  it('creates overlays from Classic unless given a document, and lists the default first', () => {
    core = testCore()
    const seen = recordEvents()
    const plain = core.overlays.create({ name: 'Plain' })
    const custom = core.overlays.create({ name: 'Wide', document: wide })
    expect(plain.document).toEqual(CLASSIC_OVERLAY)
    expect(custom.document.canvas.width).toBe(600)
    expect(core.overlays.list().map((o) => o.name)).toEqual(['Classic', 'Plain', 'Wide'])
    expect(seen.map((e) => e.type)).toEqual(['overlay.changed', 'overlay.changed'])
  })

  it('replaces the document whole and bumps the revision', () => {
    core = testCore()
    const seen = recordEvents()
    const renamed = core.overlays.update(CLASSIC_OVERLAY_ID, { name: 'Main' })
    expect(renamed).toMatchObject({ name: 'Main', revision: 2, document: CLASSIC_OVERLAY })
    const redrawn = core.overlays.update(CLASSIC_OVERLAY_ID, { document: wide }, 2)
    expect(redrawn).toMatchObject({ name: 'Main', revision: 3, document: wide })
    expect(seen.at(-1)).toMatchObject({ type: 'overlay.changed', data: redrawn })
  })

  it('refuses a stale revision, so one editor cannot overwrite another', () => {
    core = testCore()
    core.overlays.update(CLASSIC_OVERLAY_ID, { name: 'Main' })
    expect(() => core.overlays.update(CLASSIC_OVERLAY_ID, { document: wide }, 1)).toThrow(
      expect.objectContaining({ type: 'revision_mismatch', details: { revision: 2 } }),
    )
    expect(core.overlays.get(CLASSIC_OVERLAY_ID).document).toEqual(CLASSIC_OVERLAY)
  })

  it('rejects documents that do not validate', () => {
    core = testCore()
    const broken = {
      ...CLASSIC_OVERLAY,
      elements: [...CLASSIC_OVERLAY.elements, CLASSIC_OVERLAY.elements[0]!],
    }
    expect(() => core.overlays.update(CLASSIC_OVERLAY_ID, { document: broken })).toThrow()
    expect(() => core.overlays.create({ name: '' })).toThrow()
  })

  it('deletes overlays, Classic included', () => {
    core = testCore()
    const seen = recordEvents()
    const extra = core.overlays.create({ name: 'Extra' })
    core.overlays.delete(extra.id)
    expect(seen.at(-1)).toMatchObject({ type: 'overlay.deleted', data: { id: extra.id } })
    expect(() => core.overlays.get(extra.id)).toThrow(DomainError)
    expect(() => core.overlays.delete(extra.id)).toThrow(
      expect.objectContaining({ type: 'not_found' }),
    )
    core.overlays.delete(CLASSIC_OVERLAY_ID)
    expect(core.overlays.list()).toEqual([])
  })

  it("doesn't bring Classic back once it's deleted", () => {
    core = testCore()
    core.overlays.delete(CLASSIC_OVERLAY_ID)
    // The next start, on the same database.
    new OverlayService(core.db, core.events, core.artworkDir)
    expect(core.overlays.list()).toEqual([])
  })

  it('keeps an overlay already at the Classic address, as it is', () => {
    core = testCore()
    core.overlays.update(CLASSIC_OVERLAY_ID, { name: 'Mine' })
    core.db.prepare("DELETE FROM kv WHERE key = 'overlays_seeded'").run()
    new OverlayService(core.db, core.events, core.artworkDir)
    expect(core.overlays.list()).toMatchObject([{ id: CLASSIC_OVERLAY_ID, name: 'Mine' }])
  })
})

describe('overlay images', () => {
  // The smallest valid PNG header is enough: the type comes from the first bytes.
  const png = (seed: number) =>
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1])
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'halocline-images-'))
    core = createCore({
      dbPath: ':memory:',
      ytm: fakeYtm(),
      autoplay: false,
      scanner: { artworkDir: dir },
    })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('stores images by content, beside the cover art, and checks what they are', async () => {
    const name = await core.overlays.addImage(png(1))
    expect(name).toMatch(/^[0-9a-f]{40}\.png$/)
    expect(await core.overlays.addImage(png(1))).toBe(name)
    expect(readFileSync(join(dir, name))).toEqual(Buffer.from(png(1)))
    await expect(core.overlays.addImage(new TextEncoder().encode('<svg/>'))).rejects.toThrow(
      /PNG, JPEG, WebP or GIF/,
    )
    await expect(core.overlays.addImage(new Uint8Array(11 * 1024 * 1024))).rejects.toThrow(/10 MB/)
  })

  it('exports an overlay with its images, and imports it whole elsewhere', async () => {
    const logo = await core.overlays.addImage(png(1))
    const mask = await core.overlays.addImage(png(2))
    const doc: OverlayDocument = OverlayDocument.parse({
      ...CLASSIC_OVERLAY,
      elements: [
        ...CLASSIC_OVERLAY.elements,
        { type: 'image', id: 'logo', x: 0, y: 0, width: 50, height: 50, src: logo, mask },
      ],
    })
    const overlay = core.overlays.create({ name: 'With logo', document: doc })
    const file = JSON.parse(JSON.stringify(await core.overlays.exportFile(overlay.id))) as {
      images: Record<string, string>
    }
    expect(Object.keys(file.images).sort()).toEqual([logo, mask].sort())

    // Somewhere else: an empty image folder.
    rmSync(dir, { recursive: true, force: true })
    const imported = await core.overlays.importFile(file, 'x')
    expect(imported).toMatchObject({ name: 'With logo', document: doc })
    expect(readFileSync(join(dir, logo))).toEqual(Buffer.from(png(1)))

    // An image under someone else's name is refused.
    const forged = { ...file, images: { [logo]: Buffer.from(png(3)).toString('base64') } }
    await expect(core.overlays.importFile(forged, 'x')).rejects.toThrow(/doesn't match its name/)
  })
})
