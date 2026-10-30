// Overlay files (PLAN §8): an overlay exported to share or back up, and read back
// as a new overlay. The document is validated like any other, so a file can't
// break the page.
import { z } from 'zod'
import { DomainError } from '../errors'
import { NewOverlay, Overlay, OverlayDocument } from './schema'

export const OVERLAY_FILE_FORMAT = 'halocline-overlay'

export const OverlayFile = z.object({
  format: z.literal(OVERLAY_FILE_FORMAT),
  version: z.literal(1),
  name: Overlay.shape.name,
  document: OverlayDocument,
})
export type OverlayFile = z.infer<typeof OverlayFile>

export function toOverlayFile(overlay: Overlay): OverlayFile {
  return { format: OVERLAY_FILE_FORMAT, version: 1, name: overlay.name, document: overlay.document }
}

/**
 * The overlay in a file's JSON: an exported file, or a bare document (named
 * `fallbackName`), as `GET /v1/overlays/{id}` returns inside `document`.
 */
export function readOverlayFile(data: unknown, fallbackName: string): NewOverlay {
  const isFile = typeof data === 'object' && data !== null && 'format' in data
  const parsed = isFile
    ? OverlayFile.safeParse(data)
    : OverlayDocument.transform((document) => ({ name: fallbackName, document })).safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    const where = issue.path.join(' › ')
    throw new DomainError(
      'invalid_request',
      `Not a Halocline overlay: ${where ? `${where}: ` : ''}${issue.message}`,
    )
  }
  return { name: parsed.data.name, document: parsed.data.document }
}
