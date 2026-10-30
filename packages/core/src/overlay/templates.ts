import { CLASSIC_OVERLAY } from './classic'
import { SYSTEM_FONT, type OverlayDocument } from './schema'

/** A starting point for a new overlay (PLAN §8); the editor copies its document. */
export interface OverlayTemplate {
  id: string
  name: string
  description: string
  document: OverlayDocument
}

const shadow = '0 1px 3px rgb(0 0 0 / 0.6)'
const text = {
  type: 'text',
  opacity: 1,
  font: SYSTEM_FONT,
  weight: 400,
  color: '#ffffff',
  align: 'left',
  shadow,
  minScale: 0.75,
} as const
const progress = {
  type: 'progress',
  opacity: 1,
  fill: '#5ccf9e',
  pausedFill: '#9aa3ad',
  track: 'rgb(255 255 255 / 0.2)',
  edge: null,
} as const
const art = {
  type: 'art',
  opacity: 1,
  placeholder: 'rgb(255 255 255 / 0.15)',
  pausedShade: 'rgb(0 0 0 / 0.55)',
  pauseSign: '#ffffff',
} as const
const behaviour = { version: 1, fadeMs: 300, hideAfterPausedMs: 5 * 60_000 } as const

/** A rounded bar: round art, two short lines and a thin progress line. */
const PILL: OverlayDocument = {
  ...behaviour,
  canvas: { width: 420, height: 56 },
  elements: [
    {
      type: 'rect',
      id: 'panel',
      x: 0,
      y: 0,
      width: 420,
      height: 56,
      opacity: 1,
      fill: 'rgb(0 0 0 / 0.75)',
      radius: 28,
    },
    { ...art, id: 'art', x: 8, y: 8, width: 40, height: 40, radius: 20 },
    {
      ...text,
      id: 'title',
      text: '{title}',
      x: 60,
      y: 7,
      width: 336,
      height: 19.2,
      size: 16,
      weight: 600,
    },
    {
      ...text,
      id: 'artist',
      text: '{artists}',
      x: 60,
      y: 26,
      width: 336,
      height: 15.6,
      size: 13,
      opacity: 0.8,
    },
    { ...progress, id: 'bar', x: 60, y: 45, width: 336, height: 3 },
  ],
}

/** Large art with the song under it, for a corner of a camera scene. */
const CARD: OverlayDocument = {
  ...behaviour,
  canvas: { width: 240, height: 320 },
  elements: [
    {
      type: 'rect',
      id: 'panel',
      x: 0,
      y: 0,
      width: 240,
      height: 320,
      opacity: 1,
      fill: 'rgb(0 0 0 / 0.75)',
      radius: 12,
    },
    { ...art, id: 'art', x: 12, y: 12, width: 216, height: 216, radius: 8 },
    {
      ...text,
      id: 'title',
      text: '{title}',
      x: 12,
      y: 238,
      width: 216,
      height: 24,
      size: 20,
      weight: 600,
      align: 'center',
    },
    {
      ...text,
      id: 'artist',
      text: '{artists}',
      x: 12,
      y: 264,
      width: 216,
      height: 19.2,
      size: 16,
      opacity: 0.8,
      align: 'center',
    },
    { ...progress, id: 'bar', x: 12, y: 298, width: 216, height: 6 },
  ],
}

/** No panel and no art: shadowed text over the scene, like a lower third. */
const LOWER_THIRD: OverlayDocument = {
  ...behaviour,
  canvas: { width: 640, height: 96 },
  elements: [
    {
      ...text,
      id: 'artist',
      text: '{artists}',
      x: 0,
      y: 4,
      width: 640,
      height: 26.4,
      size: 22,
      opacity: 0.9,
      shadow: '0 2px 6px rgb(0 0 0 / 0.8)',
    },
    {
      ...text,
      id: 'title',
      text: '{title}',
      x: 0,
      y: 32,
      width: 640,
      height: 43.2,
      size: 36,
      weight: 700,
      shadow: '0 2px 6px rgb(0 0 0 / 0.8)',
    },
    { ...progress, id: 'bar', x: 0, y: 88, width: 640, height: 4, track: 'rgb(0 0 0 / 0.35)' },
  ],
}

export const OVERLAY_TEMPLATES: OverlayTemplate[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Art and two lines on a dark panel, with the progress bar along the bottom.',
    document: CLASSIC_OVERLAY,
  },
  {
    id: 'pill',
    name: 'Pill',
    description: 'A slim rounded bar with round art, for a screen edge.',
    document: PILL,
  },
  {
    id: 'card',
    name: 'Card',
    description: 'Large art with the song under it, for a corner of a camera scene.',
    document: CARD,
  },
  {
    id: 'lower-third',
    name: 'Lower third',
    description: 'Just the song in large shadowed text over the scene, and a thin bar.',
    document: LOWER_THIRD,
  },
]
