// OBS overlay documents (PLAN §8): a fixed-size canvas and the elements drawn on it.
// One renderer (@halocline/overlay) draws them in OBS and in the editor alike.
import { z } from 'zod'

/** Becomes the element's `hl-<id>` class, so OBS Custom CSS can target it. */
export const OverlayElementId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)

/**
 * A CSS value (colour, font list, shadow). The renderer sets it through the CSSOM,
 * so an invalid one is ignored rather than breaking out into other rules.
 */
const Css = z.string().min(1).max(200)

export const SYSTEM_FONT = "system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

/** Position and size in canvas pixels. */
const box = {
  id: OverlayElementId,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  opacity: z.number().min(0).max(1).default(1),
}

export const RectElement = z.object({
  type: z.literal('rect'),
  ...box,
  fill: Css.default('rgb(0 0 0 / 0.7)'),
  radius: z.number().min(0).default(0),
})

export const ArtElement = z.object({
  type: z.literal('art'),
  ...box,
  /** Shown while the song has no art. */
  placeholder: Css.default('rgb(255 255 255 / 0.15)'),
  radius: z.number().min(0).default(0),
  /** Laid over the art while paused. */
  pausedShade: Css.default('rgb(0 0 0 / 0.55)'),
  /** The pause sign's colour; null shows none. */
  pauseSign: Css.nullable().default('#ffffff'),
})

export const TextElement = z.object({
  type: z.literal('text'),
  ...box,
  /** `{title}`, `{artists}` and `{album}` are filled in; anything else is literal. */
  text: z.string().max(500).default('{title}'),
  font: Css.default(SYSTEM_FONT),
  /** Font size in canvas pixels. */
  size: z.number().positive().max(1000).default(22.5),
  weight: z.number().int().min(100).max(900).default(400),
  color: Css.default('#ffffff'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  shadow: Css.nullable().default('0 1px 3px rgb(0 0 0 / 0.6)'),
  /** A line too long for its box shrinks to fit, down to this share of `size`, then ellipsizes. */
  minScale: z.number().min(0.1).max(1).default(0.75),
})

export const ProgressElement = z.object({
  type: z.literal('progress'),
  ...box,
  fill: Css.default('#5ccf9e'),
  pausedFill: Css.default('#9aa3ad'),
  /** The unplayed part; the whole track always shows. */
  track: Css.default('rgb(0 0 0 / 0.5)'),
  /** A 1px inner edge, so the track reads on light scenes; null for none. */
  edge: Css.nullable().default('rgb(255 255 255 / 0.25)'),
})

export const OverlayElement = z.discriminatedUnion('type', [
  RectElement,
  ArtElement,
  TextElement,
  ProgressElement,
])
export type OverlayElement = z.infer<typeof OverlayElement>

export const OverlayDocument = z
  .object({
    version: z.literal(1),
    /** The design size. The page scales the canvas to fit the Browser Source. */
    canvas: z.object({
      width: z.number().int().min(1).max(7680),
      height: z.number().int().min(1).max(4320),
    }),
    /** Show, hide and track-change cross-fades. */
    fadeMs: z.number().int().min(0).max(5000).default(300),
    /** A pause this long reads as stopped and hides the overlay; null never hides it. */
    hideAfterPausedMs: z
      .number()
      .int()
      .positive()
      .nullable()
      .default(5 * 60_000),
    /** Paint order: the first is at the back. */
    elements: z.array(OverlayElement).max(200),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>()
    doc.elements.forEach((element, i) => {
      if (seen.has(element.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['elements', i, 'id'],
          message: `Duplicate element id "${element.id}"`,
        })
      }
      seen.add(element.id)
    })
  })
export type OverlayDocument = z.infer<typeof OverlayDocument>

/** Generated ids are UUIDs; the default overlay's is `now-playing`. Used in the overlay's URL. */
export const OverlayId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

/** Served at `/overlay/now-playing`, the address OBS scenes already use. It can't be deleted. */
export const DEFAULT_OVERLAY_ID = 'now-playing'

export const Overlay = z.object({
  id: OverlayId,
  name: z.string().min(1).max(100),
  /** Bumped by every change; send it back as `If-Match` to avoid overwriting another edit. */
  revision: z.number().int().positive(),
  document: OverlayDocument,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type Overlay = z.infer<typeof Overlay>

export const NewOverlay = z
  .object({
    name: Overlay.shape.name,
    /** Classic when left out. */
    document: OverlayDocument.optional(),
  })
  .strict()
export type NewOverlay = z.infer<typeof NewOverlay>

/** The document is replaced whole, never merged. */
export const OverlayUpdate = z
  .object({ name: Overlay.shape.name, document: OverlayDocument })
  .partial()
  .strict()
export type OverlayUpdate = z.infer<typeof OverlayUpdate>
