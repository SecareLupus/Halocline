import type { Db } from '../db'
import type { EventBus } from '../events'
import type { AnalysisStatus, AudioFeatures, Source } from '../schemas'
import type { TrackStore } from '../stream/track-cache'
import type { LibraryService } from './library'
import type { SettingsService } from './settings'

/**
 * Bumped when the analysis changes enough that old results should be redone
 * (a new model, a fixed bug); older rows are then analyzed again.
 */
export const ANALYSIS_VERSION = 1
/** Longer tracks (DJ mixes, audiobooks) aren't analyzed: one decode would need gigabytes. */
export const MAX_ANALYSIS_MS = 20 * 60_000

/** Measures a track; the app supplies one that runs in a hidden window. */
export interface AudioAnalyzer {
  analyze(source: Source): Promise<AudioFeatures>
  /** Nothing left to analyze for now: a chance to free memory. */
  idle?(): void
}

/**
 * The analyzer can't run at all right now (no model, a crashed window): stop
 * and try again later, without marking the track as failed.
 */
export class AnalyzerUnavailable extends Error {}

interface FeatureRow {
  recording_id: string
  bpm: number | null
  camelot_key: string | null
  loudness_lufs: number | null
  energy: number | null
  embedding: Buffer | null
}

/**
 * Audio analysis in the background (PLAN §7): local files first, then cloud
 * tracks already in the prefetch cache (there's no separate download for
 * analysis). One track at a time; results go in `features`, tagged with
 * ANALYSIS_VERSION.
 */
export class AnalysisService {
  private analyzer: AudioAnalyzer | null = null
  private running: Promise<void> | null = null
  private again = false
  private current: string | null = null
  private lastError: string | null = null
  private model: AnalysisStatus['model'] = { state: 'unavailable', progress: 0, error: null }

  constructor(
    private readonly db: Db,
    private readonly library: LibraryService,
    private readonly settings: SettingsService,
    private readonly tracks: TrackStore | null,
    private readonly events: EventBus,
  ) {
    events.subscribe((e) => {
      // New files, a newly cached track, or analysis switched on.
      if (
        e.type === 'library.changed' ||
        e.type === 'track.changed' ||
        e.type === 'settings.changed'
      )
        this.kick()
    })
  }

  /** Starts analyzing with `analyzer`; the app calls this once it can run one. */
  attach(analyzer: AudioAnalyzer): void {
    this.analyzer = analyzer
    this.kick()
  }

  /** The analyzer's model download, for the status. */
  setModel(model: AnalysisStatus['model']): void {
    this.model = model
    this.publish()
  }

  status(): AnalysisStatus {
    const { analyzed, failed } = this.db
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE error IS NULL) AS analyzed,
                COUNT(*) FILTER (WHERE error IS NOT NULL) AS failed
         FROM features WHERE version >= ?`,
      )
      .get(ANALYSIS_VERSION) as { analyzed: number; failed: number }
    return {
      enabled: this.settings.get().analysis.enabled,
      model: this.model,
      analyzed,
      failed,
      pending: this.pending().length,
      current: this.current,
      lastError: this.lastError,
    }
  }

  /** Analysis results for these recordings, where there are any. */
  features(recordingIds: string[]): Map<string, AudioFeatures> {
    const found = new Map<string, AudioFeatures>()
    if (!recordingIds.length) return found
    const query = this.db.prepare(
      `SELECT * FROM features WHERE recording_id = ? AND version >= ? AND error IS NULL`,
    )
    for (const id of new Set(recordingIds)) {
      const row = query.get(id, ANALYSIS_VERSION) as FeatureRow | undefined
      if (row) found.set(id, toFeatures(row))
    }
    return found
  }

  /**
   * Library recordings that sound most like `embedding` (cosine), best first:
   * autoplay's "library neighbours" (PLAN §7). A brute-force scan, which is
   * fast enough for a personal library.
   */
  nearest(
    embedding: number[],
    options: { limit: number; streamSafe?: boolean },
  ): { recordingId: string; similarity: number }[] {
    const rows = this.db
      .prepare(
        `SELECT f.recording_id, f.embedding FROM features f
         JOIN recordings r ON r.id = f.recording_id
         WHERE f.embedding IS NOT NULL AND f.version >= ? AND r.in_library = 1
           ${options.streamSafe ? 'AND r.stream_safe = 1' : ''}`,
      )
      .all(ANALYSIS_VERSION) as { recording_id: string; embedding: Buffer }[]
    const query = Float32Array.from(embedding)
    return rows
      .map((row) => {
        const v = new Float32Array(Uint8Array.from(row.embedding).buffer)
        let dot = 0
        for (let i = 0; i < v.length; i++) dot += v[i]! * query[i]!
        return { recordingId: row.recording_id, similarity: dot }
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.limit)
  }

  /** Stores a result; also used by tests and imports. */
  save(recordingId: string, features: AudioFeatures, analyzedFrom: Source['kind']): void {
    const embedding = features.embedding
      ? Buffer.from(Float32Array.from(features.embedding).buffer)
      : null
    this.db
      .prepare(
        `INSERT OR REPLACE INTO features
           (recording_id, bpm, camelot_key, loudness_lufs, energy, embedding, analyzed_from,
            version, analyzed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        recordingId,
        features.bpm,
        features.camelotKey,
        features.loudnessLufs,
        features.energy,
        embedding,
        analyzedFrom === 'local' ? 'local' : 'cache',
        ANALYSIS_VERSION,
        new Date().toISOString(),
      )
  }

  /** Analyzes what's waiting, one track at a time. Resolves when nothing's left. */
  kick(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.drain().finally(() => {
      this.running = null
      if (this.again) {
        this.again = false
        void this.kick()
      }
    })
    return this.running
  }

  private async drain(): Promise<void> {
    while (this.analyzer && this.settings.get().analysis.enabled) {
      const first = this.pending()[0]
      const next = first && this.library.source(first.id)
      if (!next) break
      this.current = this.library.get(next.recordingId)?.title ?? null
      this.publish()
      try {
        this.save(next.recordingId, await this.analyzer.analyze(next), next.kind)
        this.lastError = null
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.lastError = message
        if (err instanceof AnalyzerUnavailable) break
        this.fail(next.recordingId, message)
      } finally {
        this.current = null
        this.publish()
      }
    }
    this.analyzer?.idle?.()
  }

  private fail(recordingId: string, error: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO features (recording_id, version, analyzed_at, error)
         VALUES (?, ?, ?, ?)`,
      )
      .run(recordingId, ANALYSIS_VERSION, new Date().toISOString(), error.slice(0, 500))
  }

  /**
   * Sources to analyze, best first: one per recording without a current result,
   * local files before cached cloud tracks, library songs and recent plays first.
   */
  private pending(): Pick<Source, 'id' | 'recordingId' | 'kind' | 'locator'>[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.recording_id AS recordingId, s.kind, s.locator FROM sources s
         JOIN recordings r ON r.id = s.recording_id
         LEFT JOIN features f ON f.recording_id = r.id AND f.version >= ?
         WHERE f.recording_id IS NULL AND s.available = 1
           AND (r.duration_ms IS NULL OR r.duration_ms <= ?)
         ORDER BY s.kind = 'local' DESC, r.in_library DESC, r.last_played_at DESC`,
      )
      .all(ANALYSIS_VERSION, MAX_ANALYSIS_MS) as Pick<
      Source,
      'id' | 'recordingId' | 'kind' | 'locator'
    >[]
    const seen = new Set<string>()
    return rows.filter((s) => {
      if (seen.has(s.recordingId)) return false
      if (s.kind === 'ytm' && !this.tracks?.isCached(s)) return false
      seen.add(s.recordingId)
      return true
    })
  }

  private publish(): void {
    this.events.publish({ type: 'analysis.changed', data: this.status() })
  }
}

function toFeatures(row: FeatureRow): AudioFeatures {
  // Copied: a blob's bytes needn't be aligned for a Float32Array view.
  const embedding = row.embedding
    ? Array.from(new Float32Array(Uint8Array.from(row.embedding).buffer))
    : null
  return {
    bpm: row.bpm,
    camelotKey: row.camelot_key,
    loudnessLufs: row.loudness_lufs,
    energy: row.energy,
    embedding,
  }
}
