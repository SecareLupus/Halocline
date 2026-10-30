import { describe, expect, it } from 'vitest'
import { CLASSIC_OVERLAY, OVERLAY_TEMPLATES, OverlayDocument } from '../src'

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
