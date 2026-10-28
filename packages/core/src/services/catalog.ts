import { DomainError } from '../errors'
import type { YtmCatalog } from '../providers/ytm'
import { candidateSong, type LinkResolver } from '../resolve/resolver'
import { looksLikeUrl } from '../resolve/links'
import type { Recording, Resolution, ResolveCandidate, SearchResult, YtmSong } from '../schemas'
import type { LibraryService } from './library'

export type SearchScope = 'library' | 'ytm' | 'all'

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
  ) {}

  /** Library hits first (PLAN §1), then YTM songs that aren't already among them. */
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
    }
    return results
  }

  /**
   * Turns an input into a recording: a recordingId, a YTM ref or link, or a
   * library query with exactly one match. Other links wait for the resolver (PLAN §5).
   */
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
