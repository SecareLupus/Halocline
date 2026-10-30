// Changes the editor makes to a document (PLAN §8). Each returns a new document
// and leaves the old one as it was, ready for undo later.
import { OverlayElement, type OverlayDocument } from '@halocline/core/overlay'

export type ElementType = OverlayElement['type']

export const ELEMENT_TYPES: { type: ElementType; label: string }[] = [
  { type: 'rect', label: 'Panel' },
  { type: 'art', label: 'Album art' },
  { type: 'text', label: 'Text' },
  { type: 'progress', label: 'Progress bar' },
]

const ID_BASE: Record<ElementType, string> = {
  rect: 'panel',
  art: 'art',
  text: 'text',
  progress: 'bar',
}

/** `base` if it's free, else `base-2`, `base-3` and so on. */
export function uniqueId(doc: OverlayDocument, base: string): string {
  const taken = new Set(doc.elements.map((e) => e.id))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * Adds an element at the front, with the schema's default styles, placed and
 * sized to suit the canvas: a panel or bar spans it, art fills its height.
 */
export function addElement(
  doc: OverlayDocument,
  type: ElementType,
): { doc: OverlayDocument; id: string } {
  const { width, height } = doc.canvas
  const id = uniqueId(doc, ID_BASE[type])
  const side = Math.min(width, height)
  // Text defaults to 22.5px, so its line is 27px tall.
  const line = Math.min(27, height)
  const box =
    type === 'rect'
      ? { x: 0, y: 0, width, height }
      : type === 'art'
        ? { x: 0, y: 0, width: side, height: side }
        : type === 'text'
          ? { x: 0, y: (height - line) / 2, width, height: line }
          : { x: 0, y: height - Math.min(6, height), width, height: Math.min(6, height) }
  const element = OverlayElement.parse({ type, id, ...box })
  return { doc: { ...doc, elements: [...doc.elements, element] }, id }
}

export function updateElement(
  doc: OverlayDocument,
  id: string,
  changes: Partial<OverlayElement>,
): OverlayDocument {
  return {
    ...doc,
    elements: doc.elements.map((e) => (e.id === id ? ({ ...e, ...changes } as OverlayElement) : e)),
  }
}

export function removeElement(doc: OverlayDocument, id: string): OverlayDocument {
  return { ...doc, elements: doc.elements.filter((e) => e.id !== id) }
}

/** Moves an element towards the front (+1) or the back (-1) of the paint order. */
export function moveElement(doc: OverlayDocument, id: string, by: 1 | -1): OverlayDocument {
  const from = doc.elements.findIndex((e) => e.id === id)
  const to = from + by
  if (from < 0 || to < 0 || to >= doc.elements.length) return doc
  const elements = [...doc.elements]
  ;[elements[from], elements[to]] = [elements[to]!, elements[from]!]
  return { ...doc, elements }
}

/**
 * Reads a colour as browsers report it once computed (`rgb(r, g, b)` or
 * `rgba(r, g, b, a)`; the space-separated form too), for a colour picker.
 */
export function parseRgb(css: string): { hex: string; alpha: number } | null {
  const m = css
    .trim()
    .match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i)
  if (!m) return null
  const channel = (s: string) =>
    Math.max(0, Math.min(255, Math.round(Number(s))))
      .toString(16)
      .padStart(2, '0')
  const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1)
  return { hex: `#${channel(m[1]!)}${channel(m[2]!)}${channel(m[3]!)}`, alpha }
}

/** A picker's `#rrggbb` and an alpha as a CSS colour: plain hex when it's opaque. */
export function rgbCss(hex: string, alpha: number): string {
  if (alpha >= 1) return hex
  const n = parseInt(hex.slice(1), 16)
  const a = Math.round(Math.max(0, alpha) * 100) / 100
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`
}
