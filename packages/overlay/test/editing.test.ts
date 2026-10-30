import { CLASSIC_OVERLAY, OverlayDocument } from '@halocline/core/overlay'
import { describe, expect, it } from 'vitest'
import {
  addElement,
  moveElement,
  parseRgb,
  removeElement,
  rgbCss,
  uniqueId,
  updateElement,
} from '../src/editing'
import { SAMPLES, sampleState } from '../src/samples'

const ids = (doc: OverlayDocument) => doc.elements.map((e) => e.id)

describe('uniqueId', () => {
  it('numbers ids that are taken', () => {
    expect(uniqueId(CLASSIC_OVERLAY, 'logo')).toBe('logo')
    expect(uniqueId(CLASSIC_OVERLAY, 'title')).toBe('title-2')
    const { doc } = addElement(CLASSIC_OVERLAY, 'text')
    expect(uniqueId(addElement(doc, 'text').doc, 'text')).toBe('text-3')
  })
})

describe('addElement', () => {
  it('adds a valid element at the front, sized to the canvas', () => {
    const { doc, id } = addElement(CLASSIC_OVERLAY, 'progress')
    expect(id).toBe('bar-2')
    expect(doc.elements.at(-1)).toMatchObject({ id, x: 0, y: 134, width: 375, height: 6 })
    expect(OverlayDocument.safeParse(doc).success).toBe(true)
    expect(CLASSIC_OVERLAY.elements).toHaveLength(5)
  })

  it('makes art square, as tall as the canvas', () => {
    const { doc } = addElement(CLASSIC_OVERLAY, 'art')
    expect(doc.elements.at(-1)).toMatchObject({
      width: 140,
      height: 140,
      placeholder: expect.any(String),
    })
  })
})

describe('updateElement, removeElement, moveElement', () => {
  it('changes only the element named', () => {
    const doc = updateElement(CLASSIC_OVERLAY, 'title', { color: 'gold' })
    expect(doc.elements.find((e) => e.id === 'title')).toMatchObject({ color: 'gold', size: 22.5 })
    expect(doc.elements.find((e) => e.id === 'artist')).toMatchObject({ color: '#ffffff' })
  })

  it('removes and reorders, staying within the list', () => {
    expect(ids(removeElement(CLASSIC_OVERLAY, 'panel'))).toEqual(['art', 'artist', 'title', 'bar'])
    expect(ids(moveElement(CLASSIC_OVERLAY, 'panel', 1))).toEqual([
      'art',
      'panel',
      'artist',
      'title',
      'bar',
    ])
    expect(moveElement(CLASSIC_OVERLAY, 'panel', -1)).toBe(CLASSIC_OVERLAY)
    expect(moveElement(CLASSIC_OVERLAY, 'bar', 1)).toBe(CLASSIC_OVERLAY)
  })
})

describe('colours', () => {
  it('reads computed colours, with or without alpha', () => {
    expect(parseRgb('rgb(92, 207, 158)')).toEqual({ hex: '#5ccf9e', alpha: 1 })
    expect(parseRgb('rgba(0, 0, 0, 0.7)')).toEqual({ hex: '#000000', alpha: 0.7 })
    expect(parseRgb('rgb(255 255 255 / 25%)')).toEqual({ hex: '#ffffff', alpha: 0.25 })
    expect(parseRgb('linear-gradient(red, blue)')).toBeNull()
  })

  it('writes hex when opaque, rgb with alpha otherwise', () => {
    expect(rgbCss('#5ccf9e', 1)).toBe('#5ccf9e')
    expect(rgbCss('#000000', 0.7)).toBe('rgb(0 0 0 / 0.7)')
    expect(rgbCss('#ff8000', 0.333)).toBe('rgb(255 128 0 / 0.33)')
  })
})

describe('sampleState', () => {
  it('covers playing, paused, long names and missing art', () => {
    const now = 1_000_000
    expect(SAMPLES.map((s) => s.name)).toEqual(['playing', 'paused', 'long', 'no-art'])
    expect(sampleState('playing', now)).toMatchObject({
      playing: true,
      pausedAt: null,
      positionMs: 80_000,
    })
    expect(sampleState('paused', now)).toMatchObject({ playing: false, pausedAt: now })
    expect(sampleState('no-art', now).current?.recording.artwork).toBeNull()
    expect(sampleState('long', now).current?.recording.artwork).toMatch(/^data:image\/svg\+xml,/)
  })
})
