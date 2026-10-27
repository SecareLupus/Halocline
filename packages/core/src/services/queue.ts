import { randomUUID } from 'node:crypto'
import { getKv, setKv, type Db } from '../db'
import { DomainError } from '../errors'
import type { EventBus } from '../events'
import type { Queue, QueueItem, QueueOrigin, QueuePosition } from '../schemas'
import type { LibraryService } from './library'
import type { SettingsService } from './settings'

interface QueueRow {
  id: string
  recording_id: string
  pinned_source_id: string | null
  origin: QueueOrigin
  requested_by: string | null
  added_at: string
  position: number
}

export interface AddToQueue {
  recordingId: string
  position?: QueuePosition
  origin: QueueOrigin
  requestedBy?: string
  /** Optimistic concurrency: reject if the queue revision has moved on. */
  expectedRevision?: number
}

const REVISION_KEY = 'queue.revision'

/**
 * The upcoming queue, persisted so it survives a restart. Every mutation bumps
 * `revision`; callers may pass the revision they last saw to avoid lost updates.
 */
export class QueueService {
  constructor(
    private readonly db: Db,
    private readonly library: LibraryService,
    private readonly settings: SettingsService,
    private readonly events: EventBus,
  ) {}

  get revision(): number {
    return Number(getKv(this.db, REVISION_KEY) ?? 0)
  }

  list(): Queue {
    const rows = this.db.prepare('SELECT * FROM queue_items ORDER BY position').all() as QueueRow[]
    return { revision: this.revision, items: rows.map((r) => this.toItem(r)) }
  }

  get(id: string): QueueItem {
    const row = this.row(id)
    return this.toItem(row)
  }

  add(input: AddToQueue): QueueItem {
    const recording = this.library.require(input.recordingId)
    if (this.settings.get().streamSafeMode && !recording.streamSafe) {
      throw new DomainError(
        'stream_safe_violation',
        `"${recording.title}" is not tagged stream-safe`,
        { recordingId: recording.id },
      )
    }
    const id = randomUUID()
    this.mutate(input.expectedRevision, () => {
      const position = this.insertionIndex(input.position ?? 'end')
      this.db
        .prepare('UPDATE queue_items SET position = position + 1 WHERE position >= ?')
        .run(position)
      this.db
        .prepare(
          `INSERT INTO queue_items (id, recording_id, origin, requested_by, added_at, position)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          recording.id,
          input.origin,
          input.requestedBy ?? null,
          new Date().toISOString(),
          position,
        )
    })
    return this.get(id)
  }

  move(id: string, position: QueuePosition, expectedRevision?: number): QueueItem {
    this.mutate(expectedRevision, () => {
      if (typeof position === 'object' && position.after === id) return
      this.detach(id)
      const index = this.insertionIndex(position)
      this.db
        .prepare('UPDATE queue_items SET position = position + 1 WHERE position >= ?')
        .run(index)
      this.db.prepare('UPDATE queue_items SET position = ? WHERE id = ?').run(index, id)
    })
    return this.get(id)
  }

  pinSource(id: string, sourceId: string | null, expectedRevision?: number): QueueItem {
    const item = this.get(id)
    if (sourceId) {
      const source = this.library.source(sourceId)
      if (!source || source.recordingId !== item.recordingId) {
        throw new DomainError('not_found', `No source ${sourceId} for this recording`)
      }
    }
    this.mutate(expectedRevision, () => {
      this.db.prepare('UPDATE queue_items SET pinned_source_id = ? WHERE id = ?').run(sourceId, id)
    })
    return this.get(id)
  }

  remove(id: string, expectedRevision?: number): void {
    this.mutate(expectedRevision, () => {
      this.detach(id)
      this.db.prepare('DELETE FROM queue_items WHERE id = ?').run(id)
    })
  }

  clear(expectedRevision?: number): void {
    this.mutate(expectedRevision, () => {
      this.db.prepare('DELETE FROM queue_items').run()
    })
  }

  /** Removes and returns the first item, for the player to start. */
  takeNext(): QueueItem | undefined {
    const row = this.db.prepare('SELECT * FROM queue_items ORDER BY position LIMIT 1').get() as
      QueueRow | undefined
    if (!row) return undefined
    const item = this.toItem(row)
    this.remove(row.id)
    return item
  }

  private mutate(expectedRevision: number | undefined, change: () => void): void {
    const revision = this.db.transaction(() => {
      const current = this.revision
      if (expectedRevision !== undefined && expectedRevision !== current) {
        throw new DomainError('revision_mismatch', 'The queue changed since you last read it', {
          expected: expectedRevision,
          current,
        })
      }
      change()
      setKv(this.db, REVISION_KEY, String(current + 1))
      return current + 1
    })()
    this.events.publish({ type: 'queue.changed', data: { revision } })
  }

  /** Takes an item out of the ordering and closes the gap it leaves. */
  private detach(id: string): void {
    const { position } = this.row(id)
    this.db.prepare('UPDATE queue_items SET position = -1 WHERE id = ?').run(id)
    this.db
      .prepare('UPDATE queue_items SET position = position - 1 WHERE position > ?')
      .run(position)
  }

  private insertionIndex(position: QueuePosition): number {
    if (position === 'next') return 0
    if (position === 'end') {
      const { n } = this.db
        .prepare('SELECT COUNT(*) AS n FROM queue_items WHERE position >= 0')
        .get() as { n: number }
      return n
    }
    return this.row(position.after).position + 1
  }

  private row(id: string): QueueRow {
    const row = this.db.prepare('SELECT * FROM queue_items WHERE id = ?').get(id) as
      QueueRow | undefined
    if (!row) throw new DomainError('not_found', `No queue item with id ${id}`)
    return row
  }

  private toItem(r: QueueRow): QueueItem {
    return {
      id: r.id,
      recordingId: r.recording_id,
      pinnedSourceId: r.pinned_source_id,
      origin: r.origin,
      requestedBy: r.requested_by,
      addedAt: r.added_at,
      recording: this.library.require(r.recording_id),
    }
  }
}
