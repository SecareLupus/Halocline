// The editor's canvas maths (PLAN §8): what's under the pointer, what a marquee
// catches, and moving and resizing with snapping. Everything is in canvas pixels.
import type { OverlayDocument } from '@halocline/core/overlay'

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** A resize handle, by compass point. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** A line to draw while snapped: vertical at `x = at`, or horizontal at `y = at`. */
export interface Guide {
  axis: 'x' | 'y'
  at: number
}

/** Positions a moving edge or centre can snap to, per axis. */
export interface SnapTargets {
  x: number[]
  y: number[]
}

const contains = (b: Box, p: Point) =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** The frontmost element under a point, or null. */
export function hitTest(doc: OverlayDocument, point: Point): string | null {
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const element = doc.elements[i]!
    if (contains(element, point)) return element.id
  }
  return null
}

/** The box two corners span, whichever way round they are. */
export function spanBox(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/** The elements a marquee touches, in paint order. */
export function inMarquee(doc: OverlayDocument, marquee: Box): string[] {
  return doc.elements.filter((e) => intersects(e, marquee)).map((e) => e.id)
}

/** The box around several, or null for none. */
export function boundsOf(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The canvas's edges and centre, and the edges and centres of the other elements. */
export function snapTargets(canvas: { width: number; height: number }, others: Box[]): SnapTargets {
  return {
    x: [
      0,
      canvas.width / 2,
      canvas.width,
      ...others.flatMap((b) => [b.x, b.x + b.width / 2, b.x + b.width]),
    ],
    y: [
      0,
      canvas.height / 2,
      canvas.height,
      ...others.flatMap((b) => [b.y, b.y + b.height / 2, b.y + b.height]),
    ],
  }
}

/** The nearest target to any candidate within `threshold`: how far to shift, and where. */
function snapAxis(
  candidates: number[],
  targets: number[],
  threshold: number,
): { offset: number; at: number } | null {
  let best: { offset: number; at: number } | null = null
  for (const c of candidates) {
    for (const t of targets) {
      const offset = t - c
      if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) {
        best = { offset, at: t }
      }
    }
  }
  return best
}

/**
 * Moves `box` by whole pixels, then shifts it so its nearest edge or centre meets
 * a target within `threshold`. No targets, no snapping.
 */
export function snapMove(
  box: Box,
  dx: number,
  dy: number,
  targets: SnapTargets | null,
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  let mx = Math.round(dx)
  let my = Math.round(dy)
  const guides: Guide[] = []
  if (targets) {
    const x = box.x + mx
    const y = box.y + my
    const sx = snapAxis([x, x + box.width / 2, x + box.width], targets.x, threshold)
    const sy = snapAxis([y, y + box.height / 2, y + box.height], targets.y, threshold)
    if (sx) {
      mx += sx.offset
      guides.push({ axis: 'x', at: sx.at })
    }
    if (sy) {
      my += sy.offset
      guides.push({ axis: 'y', at: sy.at })
    }
  }
  return { dx: mx, dy: my, guides }
}

/**
 * Resizes `box` by dragging `handle` by whole pixels. The edges that move snap to
 * targets; with `keepRatio` a corner keeps the box's shape (and doesn't snap). It
 * never gets smaller than 1×1, and the opposite edges stay put.
 */
export function resizeBox(
  box: Box,
  handle: Handle,
  dx: number,
  dy: number,
  options: { targets?: SnapTargets | null; threshold?: number; keepRatio?: boolean } = {},
): { box: Box; guides: Guide[] } {
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')
  let left = box.x + (west ? Math.round(dx) : 0)
  let right = box.x + box.width + (east ? Math.round(dx) : 0)
  let top = box.y + (north ? Math.round(dy) : 0)
  let bottom = box.y + box.height + (south ? Math.round(dy) : 0)
  const guides: Guide[] = []
  const corner = (west || east) && (north || south)
  const keepRatio = options.keepRatio && corner

  const { targets, threshold = 0 } = options
  if (targets && !keepRatio) {
    const sx = west || east ? snapAxis([west ? left : right], targets.x, threshold) : null
    const sy = north || south ? snapAxis([north ? top : bottom], targets.y, threshold) : null
    if (sx) {
      if (west) left += sx.offset
      else right += sx.offset
      guides.push({ axis: 'x', at: sx.at })
    }
    if (sy) {
      if (north) top += sy.offset
      else bottom += sy.offset
      guides.push({ axis: 'y', at: sy.at })
    }
  }

  if (keepRatio) {
    const ratio = box.width / box.height
    let width = Math.max(1, right - left)
    let height = Math.max(1, bottom - top)
    // The side dragged further sets the size.
    if (width / box.width >= height / box.height) height = width / ratio
    else width = height * ratio
    if (west) left = right - width
    else right = left + width
    if (north) top = bottom - height
    else bottom = top + height
  }

  if (right - left < 1) {
    if (west) left = right - 1
    else right = left + 1
  }
  if (bottom - top < 1) {
    if (north) top = bottom - 1
    else bottom = top + 1
  }
  return { box: { x: left, y: top, width: right - left, height: bottom - top }, guides }
}
