import { DomainError } from '../errors'
import { parseCollectionRef, type YtmCatalog } from '../providers/ytm'
import { candidateSong, type LinkResolver } from '../resolve/resolver'
import { looksLikeUrl } from '../resolve/links'
import type {
  Recording,
  RecordingDetail,
  Resolution,
  ResolveCandidate,
  SearchResult,
  QueueItem,
  SplitResult,
  YtmCollection,
  YtmCollectionDetail,
  YtmSong,
} from '../schemas'
import type { LibraryService } from './library'
import type { AddToQueue, QueueService } from './queue'

export type SearchScope = 'library' | 'ytm' | 'all'

/** Albums and playlists shown per search, of each kind. */
const COLLECTIONS_PER_KIND = 4

/**
 * The videoId in a `ytm:<id>` ref: an explicit pick (a search result or a
 * resolver candidate), played as is. Links go through the resolver instead.
 */
export function parseYtmRef(input: string): string | undefined {
  return /^ytm:([\w-]{11})$/.exec(input.trim())?.[1]
}

/**
 * One search box and one way to turn "something to play" into a recording,
 * shared by the UI and the API.
 */
export class CatalogService {
  constructor(
    private readonly library: LibraryService,
    private readonly ytm: YtmCatalog,
    private readonly links: LinkResolver,
    private readonly queue: QueueService,
    /** Re-reads local files, through the scanner. */
    private readonly rescan: (paths: string[]) => Promise<void>,
  ) {}

  /**
   * Merges recordings that are the same song into `intoId` (PLAN §3), for when
   * matching missed it. Queued items for the merged ones play the kept one.
   */
  merge(intoId: string, fromIds: string[]): RecordingDetail {
    const { into, from } = this.library.merge(intoId, fromIds, (ids, id) =>
      this.queue.repoint(ids, id),
    )
    this.library.notifyChanged([into.id, ...from])
    return this.library.detail(into.id)
  }

  /**
   * Splits sources off onto a new recording (PLAN §3), for when matching merged
   * two different songs. Each side then takes its details from its own sources:
   * a local file's tags, otherwise YouTube Music's.
   */
  async split(recordingId: string, sourceIds: string[]): Promise<SplitResult> {
    const { original, split } = this.library.transaction(() => {
      const result = this.library.split(recordingId, sourceIds)
      this.queue.unpin(sourceIds)
      return result
    })
    await Promise.all([original.id, split.id].map((id) => this.refreshDetails(id)))
    this.library.notifyChanged([original.id, split.id])
    return { original: this.library.detail(original.id), split: this.library.detail(split.id) }
  }

  private async refreshDetails(recordingId: string): Promise<void> {
    const sources = this.library.sources(recordingId)
    const local = sources.filter((s) => s.kind === 'local')
    if (local.length) {
      // The scan updates the recording from the file's tags when it gets to it.
      this.library.rereadLocal(local.map((s) => s.id))
      void this.rescan(local.map((s) => s.locator)).catch(() => {})
      return
    }
    const ytm = sources.find((s) => s.kind === 'ytm')
    const song = ytm && (await this.ytm.getSong(ytm.locator).catch(() => undefined))
    if (!song) return
    const { title, artists, album, durationMs, artwork } = song
    this.library.update(recordingId, { title, artists, album, durationMs, artwork })
  }

  /** Library hits first (PLAN §1), then YTM songs not already among them, then YTM albums and playlists. */
  async search(query: string, scope: SearchScope = 'all', limit = 25): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    const inResults = new Set<string>()
    if (scope !== 'ytm') {
      for (const recording of this.library.search(query, limit)) {
        const sources = this.library.sources(recording.id)
        for (const s of sources) if (s.kind === 'ytm') inResults.add(s.locator)
        results.push({ kind: 'library', recording, sources })
      }
    }
    if (scope !== 'library') {
      // Albums and playlists are extras: if they fail, the songs still show.
      const collections = Promise.all(
        (['album', 'playlist'] as const).map((kind) =>
          this.ytm.searchCollections(query, kind, COLLECTIONS_PER_KIND).catch(() => []),
        ),
      )
      let songs: YtmSong[] = []
      try {
        songs = await this.ytm.searchSongs(query, limit)
      } catch (err) {
        // With library results to show, a YTM outage shouldn't fail the search.
        if (scope === 'ytm' || !results.length) {
          throw new DomainError(
            'provider_unavailable',
            `YouTube Music search failed: ${String(err)}`,
          )
        }
      }
      for (const song of songs) {
        if (!inResults.has(song.videoId))
          results.push({ kind: 'ytm', ref: `ytm:${song.videoId}`, song })
      }
      for (const collection of (await collections).flat())
        results.push({ kind: 'ytm-collection', collection })
    }
    return results
  }

  /** A YouTube Music album or playlist with its tracks (`ytm-album:…`, `ytm-playlist:…`). */
  async collection(ref: string): Promise<YtmCollectionDetail> {
    if (!parseCollectionRef(ref)) {
      throw new DomainError('invalid_request', `Not an album or playlist ref: ${ref}`)
    }
    let found: YtmCollectionDetail | undefined
    try {
      found = await this.ytm.getCollection(ref)
    } catch (err) {
      throw new DomainError('provider_unavailable', `YouTube Music lookup failed: ${String(err)}`)
    }
    if (!found) throw new DomainError('not_found', `YouTube Music has no ${ref}`)
    return found
  }

  /**
   * Queues a whole album or playlist, in order, as one change. Its songs aren't
   * saved to the library. In stream-safe mode, only those you've tagged are queued.
   */
  async enqueueCollection(
    ref: string,
    options: Omit<AddToQueue, 'recordingId'>,
  ): Promise<{ collection: YtmCollection; items: QueueItem[]; skipped: number }> {
    const { songs, ...collection } = await this.collection(ref)
    const recordingIds = this.library.batched(() =>
      this.library.transaction(() => songs.map((song) => this.library.ensureYtmSong(song).id)),
    )
    const { items, skipped } = this.queue.addMany({ ...options, recordingIds })
    return { collection, items, skipped: skipped.length }
  }

  /**
   * Turns "something to play" into a recording: a recording ID, a `ytm:` ref, a
   * track link (PLAN §5) or a library search. Anything short of one confident
   * answer is `match_ambiguous` with candidates, or `not_found`.
   */
  async resolve(input: string): Promise<Recording> {
    const byId = this.library.get(input)
    if (byId) return byId
    const videoId = parseYtmRef(input)
    if (videoId) return this.ytmRecording(videoId)
    if (looksLikeUrl(input)) {
      const resolution = await this.links.resolve(input)
      if (resolution.match) return this.materialize(resolution.match)
      throw this.unresolved(resolution.candidates, 'Nothing matched that link')
    }
    const hits = this.library.search(input, 5)
    if (hits.length === 1) return hits[0]!
    throw this.unresolved(hits.map(libraryCandidate), `Nothing in the library matches "${input}"`)
  }

  /**
   * What `input` would resolve to, without adding anything to the queue or the
   * database (`POST /v1/resolve`).
   */
  async preview(input: string): Promise<Resolution> {
    const byId = this.library.get(input)
    if (byId) {
      const only = libraryCandidate(byId)
      return { link: null, match: only, candidates: [only], cached: false }
    }
    if (parseYtmRef(input) || !looksLikeUrl(input)) {
      const hits = parseYtmRef(input) ? [] : this.library.search(input, 5).map(libraryCandidate)
      return {
        link: null,
        match: hits.length === 1 ? hits[0]! : null,
        candidates: hits,
        cached: false,
      }
    }
    return this.links.resolve(input)
  }

  /** A chosen candidate as a recording, adding a YTM song to the database if needed. */
  materialize(candidate: ResolveCandidate): Recording {
    if (candidate.source === 'library') return this.library.require(candidate.input)
    const song = candidateSong(candidate)
    if (!song)
      throw new DomainError('invalid_request', `Not a YouTube Music pick: ${candidate.input}`)
    return this.library.ensureYtmSong(song)
  }

  private unresolved(candidates: ResolveCandidate[], notFound: string): DomainError {
    if (!candidates.length) return new DomainError('not_found', notFound)
    return new DomainError('match_ambiguous', 'More than one song could be meant; pick one', {
      candidates,
    })
  }

  /**
   * Saves what `input` resolves to into the library (PLAN §3: the library is a
   * superset of local files and cloud tracks). Saving twice is harmless.
   */
  async save(input: string): Promise<Recording> {
    return this.saveRecording(await this.resolve(input))
  }

  /** Saves a YTM song we already have details for (e.g. a search result). */
  saveYtmSong(song: YtmSong): Recording {
    return this.saveRecording(this.library.ensureYtmSong(song))
  }

  private saveRecording(recording: Recording): Recording {
    return recording.inLibrary ? recording : this.library.edit(recording.id, { inLibrary: true })
  }

  /** The recording for a YTM song we already have details for (e.g. a search result). */
  addYtmSong(song: YtmSong): Recording {
    return this.library.ensureYtmSong(song)
  }

  private async ytmRecording(videoId: string): Promise<Recording> {
    const known = this.library.sourceByLocator('ytm', videoId)
    if (known) return this.library.require(known.recordingId)
    let song: YtmSong | undefined
    try {
      song = await this.ytm.getSong(videoId)
    } catch (err) {
      throw new DomainError('provider_unavailable', `YouTube Music lookup failed: ${String(err)}`)
    }
    if (!song) throw new DomainError('not_found', `YouTube Music has no song ${videoId}`)
    return this.library.ensureYtmSong(song)
  }
}

/** A library recording as a candidate. Text searches give no score, so it's 0. */
function libraryCandidate(r: Recording): ResolveCandidate {
  return {
    input: r.id,
    source: 'library',
    title: r.title,
    artists: r.artists,
    album: r.album,
    durationMs: r.durationMs,
    artwork: r.artwork,
    score: 0,
  }
}
