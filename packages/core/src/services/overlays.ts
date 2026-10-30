import { randomUUID } from 'node:crypto'
import type { Db } from '../db'
import { DomainError } from '../errors'
import type { EventBus } from '../events'
import {
  CLASSIC_OVERLAY,
  DEFAULT_OVERLAY_ID,
  NewOverlay,
  OverlayDocument,
  OverlayUpdate,
  type Overlay,
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

/**
 * OBS overlay documents (PLAN §8). Each change replaces the document whole, bumps
 * the overlay's revision and publishes `overlay.changed`, so open pages redraw.
 */
export class OverlayService {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
  ) {
    // The default overlay is always there: OBS scenes point at its address.
    const now = new Date().toISOString()
    db.prepare(
      `INSERT OR IGNORE INTO overlays (id, name, document, revision, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(DEFAULT_OVERLAY_ID, 'Now playing', JSON.stringify(CLASSIC_OVERLAY), now, now)
  }

  /** The default overlay first, then the rest in the order they were made. */
  list(): Overlay[] {
    const rows = this.db
      .prepare('SELECT * FROM overlays ORDER BY id != ?, rowid')
      .all(DEFAULT_OVERLAY_ID) as OverlayRow[]
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
    if (id === DEFAULT_OVERLAY_ID) {
      throw new DomainError('invalid_request', "The default overlay can't be deleted")
    }
    const { changes } = this.db.prepare('DELETE FROM overlays WHERE id = ?').run(id)
    if (!changes) throw new DomainError('not_found', `No overlay with id ${id}`)
    this.events.publish({ type: 'overlay.deleted', data: { id } })
  }

  private changed(id: string): Overlay {
    const overlay = this.get(id)
    this.events.publish({ type: 'overlay.changed', data: overlay })
    return overlay
  }
}
