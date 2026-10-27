import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { sep } from 'node:path'
import type { Db } from '../db'
import { DomainError } from '../errors'
import type { EventBus } from '../events'
import {
  LibraryQuery,
  NewRecording,
  NewSource,
  RecordingPatch,
  type BulkResult,
  type LibraryEntry,
  type LibraryPage,
  type LibrarySort,
  type Recording,
  type RecordingDetail,
  type Source,
  type SourceKind,
} from '../schemas'

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
  mtime_ms: number | null
  size: number | null
}

/** A local file's tags and stats, as produced by the scanner. */
export interface LocalFile {
  path: string
  mtimeMs: number
  size: number
  title: string
  artists: string[]
  album: string | null
  durationMs: number | null
  isrc: string | null
  artwork: string | null
  format: string | null
  bitrate: number | null
}

export type RecordingUpdate = Partial<
  Pick<
    Recording,
    | 'title'
    | 'artists'
    | 'album'
    | 'durationMs'
    | 'isrc'
    | 'artwork'
    | 'inLibrary'
    | 'streamSafe'
    | 'tags'
  >
>

const COLUMNS: Record<keyof RecordingUpdate, string> = {
  title: 'title',
  artists: 'artists',
  album: 'album',
  durationMs: 'duration_ms',
  isrc: 'isrc',
  artwork: 'artwork',
  inLibrary: 'in_library',
  streamSafe: 'stream_safe',
  tags: 'tags',
}

const toColumnValue = (value: unknown) =>
  Array.isArray(value) ? JSON.stringify(value) : typeof value === 'boolean' ? Number(value) : value

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

/** Keyset orderings. Every column runs the same direction, so SQL row values compare them. */
const SORTS: Record<LibrarySort, { keys: string[]; direction: 'ASC' | 'DESC' }> = {
  title: { keys: ['r.title COLLATE NOCASE', 'r.id'], direction: 'ASC' },
  artist: {
    keys: [
      "coalesce(json_extract(r.artists, '$[0]'), '') COLLATE NOCASE",
      'r.title COLLATE NOCASE',
      'r.id',
    ],
    direction: 'ASC',
  },
  added: { keys: ['r.added_at', 'r.id'], direction: 'DESC' },
}

interface Cursor {
  sort: LibrarySort
  keys: (string | number)[]
}

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url')

function decodeCursor(raw: string, sort: LibrarySort): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Cursor
    if (c.sort === sort && Array.isArray(c.keys) && c.keys.length === SORTS[sort].keys.length) {
      return c
    }
  } catch {
    // fall through
  }
  throw new DomainError('invalid_request', 'The cursor is invalid or belongs to another sort order')
}

/** Trims and de-duplicates tags, case-insensitively, keeping the first spelling. */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags.map((t) => t.trim()).filter(Boolean)) {
    const key = tag.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(tag)
    }
  }
  return out
}

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
    const id = this.insert(input)
    this.notifyChanged([id])
    return this.require(id)
  }

  /** Inserts without publishing `library.changed`; batch writers call `notifyChanged` once. */
  insert(input: NewRecording): string {
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
    return id
  }

  update(id: string, changes: RecordingUpdate): void {
    const entries = Object.entries(changes).filter(([, v]) => v !== undefined)
    if (!entries.length) return
    const sets = entries.map(([k]) => `${COLUMNS[k as keyof RecordingUpdate]} = ?`).join(', ')
    this.db
      .prepare(`UPDATE recordings SET ${sets} WHERE id = ?`)
      .run(...entries.map(([, v]) => toColumnValue(v)), id)
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  notifyChanged(recordingIds: string[]): void {
    if (recordingIds.length)
      this.events.publish({ type: 'library.changed', data: { recordingIds } })
  }

  findByIsrc(isrc: string): Recording | undefined {
    const row = this.db.prepare('SELECT * FROM recordings WHERE isrc = ? LIMIT 1').get(isrc) as
      RecordingRow | undefined
    return row && toRecording(row)
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

  /** Pages through recordings with filters, using an opaque keyset cursor. */
  browse(input: LibraryQuery = {}): LibraryPage {
    const query = LibraryQuery.parse(input)
    const sort = SORTS[query.sort]
    const where: string[] = []
    const params: unknown[] = []

    where.push('r.in_library = ?')
    params.push(query.inLibrary ? 1 : 0)
    if (query.streamSafe !== undefined) {
      where.push('r.stream_safe = ?')
      params.push(query.streamSafe ? 1 : 0)
    }
    if (query.available !== undefined) {
      where.push(
        `${query.available ? '' : 'NOT '}EXISTS (SELECT 1 FROM sources s WHERE s.recording_id = r.id AND s.available = 1)`,
      )
    }
    if (query.tag !== undefined) {
      where.push('EXISTS (SELECT 1 FROM json_each(r.tags) WHERE lower(value) = lower(?))')
      params.push(query.tag)
    }
    if (query.q !== undefined) {
      const fts = toFtsQuery(query.q)
      if (!fts) return { items: [], nextCursor: null }
      where.push('r.pk IN (SELECT rowid FROM recordings_fts WHERE recordings_fts MATCH ?)')
      params.push(fts)
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor, query.sort)
      const op = sort.direction === 'ASC' ? '>' : '<'
      where.push(`(${sort.keys.join(', ')}) ${op} (${sort.keys.map(() => '?').join(', ')})`)
      params.push(...cursor.keys)
    }

    const order = sort.keys.map((k) => `${k} ${sort.direction}`).join(', ')
    const keyColumns = sort.keys.map((k, i) => `${k.replace(/ COLLATE NOCASE$/, '')} AS k${i}`)
    const rows = this.db
      .prepare(
        `SELECT r.*, ${keyColumns.join(', ')},
           (SELECT json_group_array(DISTINCT s.kind) FROM sources s
            WHERE s.recording_id = r.id AND s.available = 1) AS kinds
         FROM recordings r
         WHERE ${where.join(' AND ')}
         ORDER BY ${order}
         LIMIT ?`,
      )
      .all(...params, query.limit + 1) as (RecordingRow & { kinds: string } & Record<
        string,
        string | number
      >)[]

    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor({ sort: query.sort, keys: sort.keys.map((_, i) => last[`k${i}`]!) })
        : null
    return {
      items: page.map((row): LibraryEntry => {
        const sourceKinds = JSON.parse(row.kinds) as SourceKind[]
        return { ...toRecording(row), available: sourceKinds.length > 0, sourceKinds }
      }),
      nextCursor,
    }
  }

  detail(id: string): RecordingDetail {
    return { ...this.require(id), sources: this.sources(id) }
  }

  /** Applies a patch to one recording. */
  edit(id: string, input: RecordingPatch): Recording {
    const patch = RecordingPatch.parse(input)
    this.transaction(() => this.applyPatch(this.require(id), patch))
    this.notifyChanged([id])
    return this.require(id)
  }

  /** Applies one patch to many recordings in a single transaction. */
  editMany(ids: string[], input: RecordingPatch): BulkResult {
    const patch = RecordingPatch.parse(input)
    const notFound: string[] = []
    const updated = this.transaction(() => {
      const done: string[] = []
      for (const id of new Set(ids)) {
        const recording = this.get(id)
        if (!recording) notFound.push(id)
        else {
          this.applyPatch(recording, patch)
          done.push(id)
        }
      }
      return done
    })
    this.notifyChanged(updated)
    return { updated: updated.length, notFound }
  }

  private applyPatch(recording: Recording, patch: RecordingPatch): void {
    let tags: string[] | undefined
    if (patch.tags) tags = normalizeTags(patch.tags)
    else if (patch.addTags || patch.removeTags) {
      const remove = new Set((patch.removeTags ?? []).map((t) => t.trim().toLocaleLowerCase()))
      tags = normalizeTags([...recording.tags, ...(patch.addTags ?? [])]).filter(
        (t) => !remove.has(t.toLocaleLowerCase()),
      )
    }
    this.update(recording.id, {
      ...(patch.inLibrary !== undefined && { inLibrary: patch.inLibrary }),
      ...(patch.streamSafe !== undefined && { streamSafe: patch.streamSafe }),
      ...(tags && { tags }),
    })
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

  sourceByLocator(kind: SourceKind, locator: string): Source | undefined {
    const row = this.db
      .prepare('SELECT * FROM sources WHERE kind = ? AND locator = ?')
      .get(kind, locator) as SourceRow | undefined
    return row && toSource(row)
  }

  /** Available local files with the stats the scanner compares against. */
  localFiles(): Record<string, { mtimeMs: number; size: number }> {
    const rows = this.db
      .prepare(
        `SELECT locator, mtime_ms, size FROM sources
         WHERE kind = 'local' AND available = 1 AND mtime_ms IS NOT NULL`,
      )
      .all() as Pick<SourceRow, 'locator' | 'mtime_ms' | 'size'>[]
    return Object.fromEntries(rows.map((r) => [r.locator, { mtimeMs: r.mtime_ms!, size: r.size! }]))
  }

  /**
   * Adds or refreshes the local source for a scanned file, creating or updating
   * its recording. Returns what happened, for scan progress.
   */
  saveLocalFile(file: LocalFile): { recordingId: string; outcome: 'added' | 'updated' | 'moved' } {
    const tags = {
      title: file.title,
      artists: file.artists,
      album: file.album,
      durationMs: file.durationMs,
      isrc: file.isrc,
    }
    const existing = this.sourceByLocator('local', file.path)
    if (existing) {
      this.update(existing.recordingId, { ...tags, ...(file.artwork && { artwork: file.artwork }) })
      this.upsertLocalSource(existing.recordingId, file)
      return { recordingId: existing.recordingId, outcome: 'updated' }
    }
    const moved = this.findMovedSource(file)
    if (moved) {
      this.db.prepare('UPDATE sources SET locator = ? WHERE id = ?').run(file.path, moved.id)
      this.upsertLocalSource(moved.recordingId, file)
      return { recordingId: moved.recordingId, outcome: 'moved' }
    }
    // Same song already known (e.g. a saved YTM track): attach the file to it.
    const match = file.isrc ? this.findByIsrc(file.isrc) : undefined
    if (match) {
      this.update(match.id, {
        inLibrary: true,
        ...(!match.artwork && file.artwork && { artwork: file.artwork }),
      })
      this.upsertLocalSource(match.id, file)
      return { recordingId: match.id, outcome: 'added' }
    }
    const recordingId = this.insert({ ...tags, artwork: file.artwork, inLibrary: true })
    this.upsertLocalSource(recordingId, file)
    return { recordingId, outcome: 'added' }
  }

  /**
   * Marks local files unavailable. Each path may be a file or a folder (everything
   * under it). Returns the affected recording IDs.
   */
  markLocalMissing(paths: string[]): string[] {
    const find = this.db.prepare(
      `SELECT id, recording_id FROM sources
       WHERE kind = 'local' AND available = 1 AND (locator = ? OR substr(locator, 1, ?) = ?)`,
    )
    const mark = this.db.prepare('UPDATE sources SET available = 0, last_checked = ? WHERE id = ?')
    const now = new Date().toISOString()
    const affected = new Set<string>()
    for (const path of paths) {
      // An exact prefix compare: LIKE would be case-insensitive.
      const prefix = path.endsWith(sep) ? path : path + sep
      for (const row of find.all(path, prefix.length, prefix) as {
        id: string
        recording_id: string
      }[]) {
        mark.run(now, row.id)
        affected.add(row.recording_id)
      }
    }
    return [...affected]
  }

  private upsertLocalSource(recordingId: string, file: LocalFile): void {
    this.db
      .prepare(
        `INSERT INTO sources (id, recording_id, kind, locator, format, bitrate, mtime_ms, size, last_checked)
         VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?)
         ON CONFLICT (kind, locator) DO UPDATE SET
           recording_id = excluded.recording_id, format = excluded.format, bitrate = excluded.bitrate,
           mtime_ms = excluded.mtime_ms, size = excluded.size, last_checked = excluded.last_checked,
           available = 1, failure_count = 0`,
      )
      .run(
        randomUUID(),
        recordingId,
        file.path,
        file.format,
        file.bitrate,
        file.mtimeMs,
        file.size,
        new Date().toISOString(),
      )
  }

  /**
   * A renamed or moved file shows up as a new path. If a local source with the
   * same size, title and duration points at a file that no longer exists, it's
   * the same file: relink it so play counts, tags and stream-safe flags survive.
   */
  private findMovedSource(file: LocalFile): Source | undefined {
    const rows = this.db
      .prepare(
        `SELECT s.*, r.title AS r_title, r.duration_ms AS r_duration FROM sources s
         JOIN recordings r ON r.id = s.recording_id
         WHERE s.kind = 'local' AND s.size = ? AND r.title = ?`,
      )
      .all(file.size, file.title) as (SourceRow & { r_title: string; r_duration: number | null })[]
    const row = rows.find(
      (r) =>
        Math.abs((r.r_duration ?? 0) - (file.durationMs ?? 0)) <= 1000 && !existsSync(r.locator),
    )
    return row && toSource(row)
  }

  source(id: string): Source | undefined {
    const row = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as
      SourceRow | undefined
    return row && toSource(row)
  }
}
