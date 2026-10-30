import { describe, expect, it } from 'vitest'
import {
  CLASSIC_OVERLAY,
  OVERLAY_TEMPLATES,
  OverlayDocument,
  readOverlayFile,
  toOverlayFile,
  type Overlay,
} from '../src'

describe('OverlayDocument', () => {
  it('accepts Classic as it is', () => {
    expect(OverlayDocument.parse(CLASSIC_OVERLAY)).toEqual(CLASSIC_OVERLAY)
  })

  it('ships templates that validate as they are, with distinct ids', () => {
    for (const template of OVERLAY_TEMPLATES) {
      expect(OverlayDocument.parse(template.document)).toEqual(template.document)
    }
    expect(new Set(OVERLAY_TEMPLATES.map((t) => t.id)).size).toBe(OVERLAY_TEMPLATES.length)
  })

  it('fills in element styles an editor leaves out', () => {
    const doc = OverlayDocument.parse({
      version: 1,
      canvas: { width: 300, height: 60 },
      elements: [{ type: 'text', id: 'line', x: 0, y: 0, width: 300, height: 30 }],
    })
    expect(doc).toMatchObject({ fadeMs: 300, hideAfterPausedMs: 300_000 })
    expect(doc.elements[0]).toMatchObject({ text: '{title}', opacity: 1, minScale: 0.75 })
  })

  it('loads documents saved before radius and borders existed, unchanged', () => {
    const old = {
      version: 1,
      canvas: { width: 100, height: 100 },
      elements: [
        { type: 'art', id: 'art', x: 0, y: 0, width: 100, height: 100, radius: 50 },
        { type: 'progress', id: 'bar', x: 0, y: 90, width: 100, height: 10 },
      ],
    }
    expect(OverlayDocument.parse(old).elements).toMatchObject([
      { radius: 50, borderWidth: 0, borderColor: '#ffffff' },
      { radius: 0 },
    ])
  })

  it('rejects duplicate ids and ids that would not make a class name', () => {
    const doc = (ids: string[]) => ({
      version: 1,
      canvas: { width: 100, height: 100 },
      elements: ids.map((id) => ({ type: 'rect', id, x: 0, y: 0, width: 1, height: 1 })),
    })
    expect(OverlayDocument.safeParse(doc(['a', 'b'])).success).toBe(true)
    expect(OverlayDocument.safeParse(doc(['a', 'a'])).success).toBe(false)
    expect(OverlayDocument.safeParse(doc(['Title'])).success).toBe(false)
    expect(OverlayDocument.safeParse(doc(['x y'])).success).toBe(false)
  })
})

describe('overlay files', () => {
  const overlay: Overlay = {
    id: 'x',
    name: 'Stream',
    revision: 3,
    document: CLASSIC_OVERLAY,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }

  it('round-trips an export, keeping the name and leaving out the id', () => {
    const file = JSON.parse(JSON.stringify(toOverlayFile(overlay))) as unknown
    expect(file).not.toHaveProperty('id')
    expect(readOverlayFile(file, 'Imported')).toEqual({
      name: 'Stream',
      document: CLASSIC_OVERLAY,
      images: {},
    })
  })

  it('takes a bare document, named after the file', () => {
    expect(readOverlayFile(CLASSIC_OVERLAY, 'classic')).toEqual({
      name: 'classic',
      document: CLASSIC_OVERLAY,
      images: {},
    })
  })

  it('says what is wrong with anything else', () => {
    expect(() => readOverlayFile({ hello: 'world' }, 'x')).toThrow(/Not a Halocline overlay/)
    const broken = {
      ...toOverlayFile(overlay),
      document: { ...CLASSIC_OVERLAY, elements: [{ type: 'rect', id: 'Bad' }] },
    }
    expect(() => readOverlayFile(broken, 'x')).toThrow(/document › elements › 0/)
    expect(() => readOverlayFile({ ...toOverlayFile(overlay), version: 2 }, 'x')).toThrow(/version/)
  })
})
