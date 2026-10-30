import { CLASSIC_OVERLAY } from '@halocline/core/overlay'
import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  hitTest,
  inMarquee,
  resizeBox,
  snapMove,
  snapTargets,
  spanBox,
} from '../src/geometry'
import { DocumentHistory } from '../src/history'
import { translateElements } from '../src/editing'

const canvas = { width: 400, height: 200 }
const box = { x: 100, y: 50, width: 80, height: 40 }

describe('hitTest and inMarquee', () => {
  it('finds the frontmost element under a point', () => {
    expect(hitTest(CLASSIC_OVERLAY, { x: 200, y: 75 })).toBe('title')
    expect(hitTest(CLASSIC_OVERLAY, { x: 50, y: 50 })).toBe('art')
    expect(hitTest(CLASSIC_OVERLAY, { x: 300, y: 20 })).toBe('panel')
    expect(hitTest(CLASSIC_OVERLAY, { x: 500, y: 20 })).toBeNull()
  })

  it('catches whatever a marquee touches, dragged either way', () => {
    expect(inMarquee(CLASSIC_OVERLAY, spanBox({ x: 360, y: 139 }, { x: 140, y: 60 }))).toEqual([
      'panel',
      'artist',
      'title',
      'bar',
    ])
    expect(boundsOf([box, { x: 0, y: 0, width: 10, height: 10 }])).toEqual({
      x: 0,
      y: 0,
      width: 180,
      height: 90,
    })
    expect(boundsOf([])).toBeNull()
  })
})

describe('snapMove', () => {
  const targets = snapTargets(canvas, [{ x: 300, y: 150, width: 50, height: 20 }])

  it('moves by whole pixels without targets', () => {
    expect(snapMove(box, 10.4, -3.6, null, 6)).toEqual({ dx: 10, dy: -4, guides: [] })
  })

  it('snaps the nearest edge or centre, and says where', () => {
    // Its centre (140) lands near the canvas centre (200) after moving 57: snaps to 60.
    expect(snapMove(box, 57, 0, targets, 6)).toMatchObject({
      dx: 60,
      guides: [{ axis: 'x', at: 200 }],
    })
    // Its bottom edge (90) moved 57 down is 147; the other box's top (150) is within reach.
    expect(snapMove(box, 0, 57, targets, 6)).toMatchObject({
      dy: 60,
      guides: [{ axis: 'y', at: 150 }],
    })
    expect(snapMove(box, 30, 0, targets, 6).guides).toEqual([])
  })
})

describe('resizeBox', () => {
  it('moves only the dragged edges, never below 1×1', () => {
    expect(resizeBox(box, 'e', 20, 99).box).toEqual({ x: 100, y: 50, width: 100, height: 40 })
    expect(resizeBox(box, 'nw', 10, 10).box).toEqual({ x: 110, y: 60, width: 70, height: 30 })
    expect(resizeBox(box, 'w', 500, 0).box).toEqual({ x: 179, y: 50, width: 1, height: 40 })
  })

  it('snaps the moving edge', () => {
    const targets = snapTargets(canvas, [])
    expect(resizeBox(box, 'e', 216, 0, { targets, threshold: 6 })).toEqual({
      box: { x: 100, y: 50, width: 300, height: 40 },
      guides: [{ axis: 'x', at: 400 }],
    })
  })

  it('keeps the shape from a corner when asked', () => {
    expect(resizeBox(box, 'se', 80, 0, { keepRatio: true }).box).toEqual({
      x: 100,
      y: 50,
      width: 160,
      height: 80,
    })
    expect(resizeBox(box, 'nw', 0, -40, { keepRatio: true }).box).toEqual({
      x: 20,
      y: 10,
      width: 160,
      height: 80,
    })
  })
})

describe('DocumentHistory', () => {
  const a = CLASSIC_OVERLAY
  const b = translateElements(a, ['art'], 10, 0)
  const c = translateElements(b, ['art'], 10, 0)

  it('undoes and redoes whole steps', () => {
    const history = new DocumentHistory()
    history.record(a, undefined, 0)
    history.record(b, undefined, 5000)
    expect(history.undo(c)).toBe(b)
    expect(history.undo(b)).toBe(a)
    expect(history.undo(a)).toBeNull()
    expect(history.redo(a)).toBe(b)
    expect(history.canRedo).toBe(true)
  })

  it('merges quick changes with the same key, and a new change drops redo', () => {
    const history = new DocumentHistory()
    history.record(a, 'title.size', 0)
    history.record(b, 'title.size', 300)
    expect(history.undo(c)).toBe(a)
    history.record(a, 'x', 400)
    expect(history.canRedo).toBe(false)
    history.record(b, 'title.size', 500)
    expect(history.undo(c)).toBe(b)
  })
})
