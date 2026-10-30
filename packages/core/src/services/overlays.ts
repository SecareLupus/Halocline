import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getKv, setKv, type Db } from '../db'
import { DomainError } from '../errors'
import type { EventBus } from '../events'
import {
  CLASSIC_OVERLAY,
  CLASSIC_OVERLAY_ID,
  imagesIn,
  NewOverlay,
  OverlayDocument,
  OverlayImageName,
  OverlayUpdate,
  readOverlayFile,
  toOverlayFile,
  type Overlay,
  type OverlayFile,
} from '../overlay'

interface OverlayRow {
  id: string
  name: string
  document: string
  revision: number
  created_at: string
  updated_at: string
}

const toOverlay = (r: OverlayRow): Overlay => ({
  id: r.id,
  name: r.name,
  revision: r.revision,
  document: OverlayDocument.parse(JSON.parse(r.document)),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

/** Set once Classic has been added, so it isn't added again after it's deleted. */
const SEEDED_KEY = 'overlays_seeded'

/** Uploaded images: big enough for a logo or a frame, small enough to keep in a file. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** The image type from its first bytes, rather than trusting a name or a header. */
function imageType(data: Uint8Array): 'png' | 'jpg' | 'webp' | 'gif' | null {
  const b = (i: number) => data[i]
  const ascii = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to))
  if (b(0) === 0x89 && ascii(1, 4) === 'PNG') return 'png'
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpg'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (ascii(0, 4) === 'GIF8') return 'gif'
  return null
}

/**
 * OBS overlay documents (PLAN §8). Each change replaces the document whole, bumps
 * the overlay's revision and publishes `overlay.changed`, so open pages redraw.
 * Uploaded images are kept by content beside the cover art, in `imageDir`, which
 * the API (`/v1/artwork`) and the app (`artwork://`) already serve.
 */
export class OverlayService {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
    private readonly imageDir: string,
  ) {
    // Halocline starts with Classic, once. After that it's the user's: deleting
    // it, or every overlay, sticks. (A database that already has it keeps it.)
    if (!getKv(db, SEEDED_KEY)) {
      const now = new Date().toISOString()
      db.prepare(
        `INSERT OR IGNORE INTO overlays (id, name, document, revision, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      ).run(CLASSIC_OVERLAY_ID, 'Classic', JSON.stringify(CLASSIC_OVERLAY), now, now)
      setKv(db, SEEDED_KEY, '1')
    }
  }

  /** Every overlay, in the order they were made; there may be none. */
  list(): Overlay[] {
    const rows = this.db.prepare('SELECT * FROM overlays ORDER BY rowid').all() as OverlayRow[]
    return rows.map(toOverlay)
  }

  get(id: string): Overlay {
    const row = this.db.prepare('SELECT * FROM overlays WHERE id = ?').get(id) as
      OverlayRow | undefined
    if (!row) throw new DomainError('not_found', `No overlay with id ${id}`)
    return toOverlay(row)
  }

  create(input: NewOverlay): Overlay {
    const { name, document = CLASSIC_OVERLAY } = NewOverlay.parse(input)
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO overlays (id, name, document, revision, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(id, name, JSON.stringify(document), now, now)
    return this.changed(id)
  }

  /** Fails with `revision_mismatch` if `expectedRevision` is given and isn't current. */
  update(id: string, changes: OverlayUpdate, expectedRevision?: number): Overlay {
    const patch = OverlayUpdate.parse(changes)
    const current = this.get(id)
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new DomainError(
        'revision_mismatch',
        `Overlay ${id} is at revision ${current.revision}`,
        {
          revision: current.revision,
        },
      )
    }
    this.db
      .prepare(
        'UPDATE overlays SET name = ?, document = ?, revision = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        patch.name ?? current.name,
        JSON.stringify(patch.document ?? current.document),
        current.revision + 1,
        new Date().toISOString(),
        id,
      )
    return this.changed(id)
  }

  delete(id: string): void {
    const { changes } = this.db.prepare('DELETE FROM overlays WHERE id = ?').run(id)
    if (!changes) throw new DomainError('not_found', `No overlay with id ${id}`)
    this.events.publish({ type: 'overlay.deleted', data: { id } })
  }

  /**
   * Stores an image (PNG, JPEG, WebP or GIF) and returns its name: the same
   * image, the same name.
   */
  async addImage(data: Uint8Array): Promise<string> {
    if (data.length > MAX_IMAGE_BYTES) {
      throw new DomainError('invalid_request', 'Images can be up to 10 MB')
    }
    const type = imageType(data)
    if (!type) throw new DomainError('invalid_request', 'Images must be PNG, JPEG, WebP or GIF')
    const name = `${createHash('sha1').update(data).digest('hex')}.${type}`
    await mkdir(this.imageDir, { recursive: true })
    await writeFile(join(this.imageDir, name), data)
    return name
  }

  /** An overlay as a file, with the images it uses, so it's complete on another machine. */
  async exportFile(id: string): Promise<OverlayFile> {
    const overlay = this.get(id)
    const images: Record<string, string> = {}
    for (const name of imagesIn(overlay.document)) {
      // An image that's gone would only be missing on the other side too.
      const data = await readFile(join(this.imageDir, name)).catch(() => null)
      if (data) images[name] = data.toString('base64')
    }
    return toOverlayFile(overlay, images)
  }

  /** A new overlay from a file's JSON (see `readOverlayFile`), storing the images it brings. */
  async importFile(data: unknown, fallbackName: string): Promise<Overlay> {
    const { images, ...overlay } = readOverlayFile(data, fallbackName)
    for (const [name, base64] of Object.entries(images)) {
      // Stored under the name its bytes give, so a file can't pass one image off as another.
      const stored = await this.addImage(Buffer.from(base64, 'base64'))
      if (stored !== OverlayImageName.parse(name)) {
        throw new DomainError('invalid_request', `The image ${name} doesn't match its name`)
      }
    }
    return this.create(overlay)
  }

  private changed(id: string): Overlay {
    const overlay = this.get(id)
    this.events.publish({ type: 'overlay.changed', data: overlay })
    return overlay
  }
}
