import { randomUUID } from 'node:crypto'
import type { Db } from '../db'
import { DomainError } from '../errors'
import type { EventBus } from '../events'
import { NewRecording, NewSource, type Recording, type Source, type SourceKind } from '../schemas'

interface RecordingRow {
  id: string
  title: string
  artists: string
  album: string | null
  duration_ms: number | null
  isrc: string | null
  artwork: string | null
  in_library: number
  stream_safe: number
  tags: string
  added_at: string
  play_count: number
  last_played_at: string | null
}

interface SourceRow {
  id: string
  recording_id: string
  kind: SourceKind
  locator: string
  format: string | null
  bitrate: number | null
  available: number
  failure_count: number
  last_checked: string | null
}

const toRecording = (r: RecordingRow): Recording => ({
  id: r.id,
  title: r.title,
  artists: JSON.parse(r.artists) as string[],
  album: r.album,
  durationMs: r.duration_ms,
  isrc: r.isrc,
  artwork: r.artwork,
  inLibrary: r.in_library === 1,
  streamSafe: r.stream_safe === 1,
  tags: JSON.parse(r.tags) as string[],
  addedAt: r.added_at,
  playCount: r.play_count,
  lastPlayedAt: r.last_played_at,
})

const toSource = (r: SourceRow): Source => ({
  id: r.id,
  recordingId: r.recording_id,
  kind: r.kind,
  locator: r.locator,
  format: r.format,
  bitrate: r.bitrate,
  available: r.available === 1,
  failureCount: r.failure_count,
  lastChecked: r.last_checked,
})

/** Turns free text into a safe FTS5 prefix query: every word must match. */
export function toFtsQuery(text: string): string | undefined {
  const words = text.match(/[\p{L}\p{N}]+/gu)
  if (!words) return undefined
  return words.map((w) => `"${w}"*`).join(' ')
}

export class LibraryService {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  create(input: NewRecording): Recording {
    const r = NewRecording.parse(input)
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO recordings
          (id, title, artists, album, duration_ms, isrc, artwork, in_library, stream_safe, tags, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        r.title,
        JSON.stringify(r.artists),
        r.album ?? null,
        r.durationMs ?? null,
        r.isrc ?? null,
        r.artwork ?? null,
        r.inLibrary ? 1 : 0,
        r.streamSafe ? 1 : 0,
        JSON.stringify(r.tags ?? []),
        new Date().toISOString(),
      )
    this.events.publish({ type: 'library.changed', data: { recordingIds: [id] } })
    return this.require(id)
  }

  get(id: string): Recording | undefined {
    const row = this.db.prepare('SELECT * FROM recordings WHERE id = ?').get(id) as
      RecordingRow | undefined
    return row && toRecording(row)
  }

  require(id: string): Recording {
    const recording = this.get(id)
    if (!recording) throw new DomainError('not_found', `No recording with id ${id}`)
    return recording
  }

  /** Full-text search over title, artists and album, best matches first. */
  search(text: string, limit = 25): Recording[] {
    const query = toFtsQuery(text)
    if (!query) return []
    const rows = this.db
      .prepare(
        `SELECT r.* FROM recordings_fts f
         JOIN recordings r ON r.pk = f.rowid
         WHERE recordings_fts MATCH ?
         ORDER BY bm25(recordings_fts), r.title
         LIMIT ?`,
      )
      .all(query, limit) as RecordingRow[]
    return rows.map(toRecording)
  }

  addSource(recordingId: string, input: NewSource): Source {
    this.require(recordingId)
    const s = NewSource.parse(input)
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO sources (id, recording_id, kind, locator, format, bitrate)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, recordingId, s.kind, s.locator, s.format ?? null, s.bitrate ?? null)
    return toSource(this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow)
  }

  sources(recordingId: string): Source[] {
    const rows = this.db
      .prepare('SELECT * FROM sources WHERE recording_id = ?')
      .all(recordingId) as SourceRow[]
    return rows.map(toSource)
  }

  source(id: string): Source | undefined {
    const row = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as
      SourceRow | undefined
    return row && toSource(row)
  }
}
