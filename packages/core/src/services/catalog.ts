import { DomainError } from '../errors'
import type { YtmCatalog } from '../providers/ytm'
import type { Recording, SearchResult, YtmSong } from '../schemas'
import type { LibraryService } from './library'

export type SearchScope = 'library' | 'ytm' | 'all'

/** Finds the videoId in a `ytm:<id>` ref or a music.youtube.com link. */
export function parseYtmRef(input: string): string | undefined {
  const ref = input.match(/^ytm:([\w-]{11})$/)
  if (ref) return ref[1]
  try {
    const url = new URL(input)
    if (url.hostname === 'music.youtube.com' && url.pathname === '/watch') {
      const v = url.searchParams.get('v')
      if (v && /^[\w-]{11}$/.test(v)) return v
    }
  } catch {
    // not a URL
  }
  return undefined
}

const looksLikeUrl = (s: string) => /^https?:\/\//i.test(s)

/**
 * One search box and one way to turn "something to play" into a recording,
 * shared by the UI and the API.
 */
export class CatalogService {
  constructor(
    private readonly library: LibraryService,
    private readonly ytm: YtmCatalog,
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
  async resolve(input: string): Promise<Recording> {
    const byId = this.library.get(input)
    if (byId) return byId
    const videoId = parseYtmRef(input)
    if (videoId) return this.ytmRecording(videoId)
    if (looksLikeUrl(input)) {
      throw new DomainError(
        'not_implemented',
        'Only YouTube Music links are resolved so far (PLAN §5)',
      )
    }
    const hits = this.library.search(input, 5)
    if (hits.length === 1) return hits[0]!
    if (hits.length === 0)
      throw new DomainError('not_found', `Nothing in the library matches "${input}"`)
    throw new DomainError('match_ambiguous', 'More than one recording matches', {
      candidates: hits,
    })
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
