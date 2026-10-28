import type { Db } from '../db'
import { DomainError } from '../errors'
import type { YtmCatalog } from '../providers/ytm'
import type { LinkMetadata, Recording, Resolution, ResolveCandidate, YtmSong } from '../schemas'
import type { LibraryService } from '../services/library'
import { parseLink, type TrackLink } from './links'
import { enrichFromDeezer, readLink } from './metadata'
import { CONFIDENT, linkTitle, PLAUSIBLE, scoreMatch } from './score'

const MAX_CANDIDATES = 5

/**
 * Turns a track link into the song to play (PLAN §5): read the link's metadata,
 * fill in an ISRC from Deezer, then match against the library and YouTube Music.
 * A confident match plays; anything less comes back as candidates, so a wrong
 * song never plays silently. Confident matches are cached by link.
 */
export class LinkResolver {
  constructor(
    private readonly db: Db,
    private readonly library: LibraryService,
    private readonly ytm: YtmCatalog,
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  /** Whether `input` is a track link this resolver reads. */
  handles(input: string): boolean {
    return parseLink(input) !== undefined
  }

  async resolve(input: string): Promise<Resolution> {
    const link = parseLink(input)
    if (!link) {
      throw new DomainError(
        'not_implemented',
        'Links from that site are not supported yet (PLAN §5)',
      )
    }
    const cached = this.cached(link)
    if (cached) return cached

    const meta = await enrichFromDeezer(
      await readLink(link, { fetch: this.fetch, ytm: this.ytm }),
      this.fetch,
    )
    const library = this.libraryCandidates(meta)
    const { songs, linked, linkedIsSong } = await this.ytmCandidates(link, meta, library.length > 0)

    // Precedence: what you own; a linked YTM song as it is; YTM's song version of a
    // linked video; then exactly the video linked.
    const confident = (list: ResolveCandidate[]) => list.find((c) => c.score >= CONFIDENT)
    const match =
      confident(library) ??
      (linkedIsSong ? linked : undefined) ??
      confident(songs) ??
      linked ??
      null
    const candidates = dedupe([
      ...(match ? [match] : []),
      ...library,
      ...songs,
      ...(linked ? [linked] : []),
    ])
      .filter((c) => c.score >= PLAUSIBLE)
      .slice(0, MAX_CANDIDATES)

    if (match) this.remember(link, meta, match)
    return { link: meta, match, candidates, cached: false }
  }

  private libraryCandidates(meta: LinkMetadata): ResolveCandidate[] {
    const found = new Map<string, Recording>()
    const byIsrc = meta.isrc ? this.library.findByIsrc(meta.isrc) : undefined
    if (byIsrc?.inLibrary) found.set(byIsrc.id, byIsrc)
    for (const r of this.library.search(linkTitle(meta.title), 20)) found.set(r.id, r)
    return rank(
      [...found.values()].map((r) => ({
        input: r.id,
        source: 'library' as const,
        title: r.title,
        artists: r.artists,
        album: r.album,
        durationMs: r.durationMs,
        artwork: r.artwork,
        score: scoreMatch(meta, r),
      })),
    )
  }

  /**
   * Songs from a YTM search, and for YouTube links the linked video itself: it's
   * exactly what was asked for, so it plays when no song version is found.
   */
  private async ytmCandidates(
    link: TrackLink,
    meta: LinkMetadata,
    haveLibrary: boolean,
  ): Promise<{
    songs: ResolveCandidate[]
    linked: ResolveCandidate | undefined
    /** The linked video is itself a YTM song (not a music video or upload). */
    linkedIsSong: boolean
  }> {
    let found: YtmSong[] = []
    try {
      found = await this.ytm.searchSongs(`${meta.artists[0] ?? ''} ${linkTitle(meta.title)}`, 10)
    } catch (err) {
      // The library may still answer; without it there's nothing to offer.
      if (!haveLibrary && link.provider !== 'ytm' && link.provider !== 'youtube') {
        throw new DomainError('provider_unavailable', `YouTube Music search failed: ${String(err)}`)
      }
    }
    const songs = rank(found.map((s) => fromSong(s, scoreMatch(meta, s))))
    const isVideo = link.provider === 'ytm' || link.provider === 'youtube'
    const asSong = found.find((s) => s.videoId === link.id)
    const linked = isVideo
      ? fromSong(
          asSong ?? {
            videoId: link.id,
            title: meta.title,
            artists: meta.artists,
            album: meta.album,
            durationMs: meta.durationMs,
            artwork: null,
          },
          1,
        )
      : undefined
    return {
      songs: songs.filter((s) => s.input !== linked?.input),
      linked,
      linkedIsSong: asSong !== undefined,
    }
  }

  private cached(link: TrackLink): Resolution | undefined {
    const row = this.db
      .prepare('SELECT candidate FROM resolutions WHERE link_key = ?')
      .get(link.key) as { candidate: string } | undefined
    if (!row) return undefined
    const { link: meta, match } = JSON.parse(row.candidate) as {
      link: LinkMetadata
      match: ResolveCandidate
    }
    // A cached library match whose recording is gone is stale.
    if (match.source === 'library' && !this.library.get(match.input)) {
      this.db.prepare('DELETE FROM resolutions WHERE link_key = ?').run(link.key)
      return undefined
    }
    return { link: meta, match, candidates: [match], cached: true }
  }

  private remember(link: TrackLink, meta: LinkMetadata, match: ResolveCandidate): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO resolutions (link_key, candidate, resolved_at) VALUES (?, ?, ?)',
      )
      .run(link.key, JSON.stringify({ link: meta, match }), new Date().toISOString())
  }
}

/** A YTM candidate back into the song it describes, for adding it to the database. */
export function candidateSong(c: ResolveCandidate): YtmSong | undefined {
  const videoId = /^ytm:([\w-]{11})$/.exec(c.input)?.[1]
  if (c.source !== 'ytm' || !videoId) return undefined
  const { title, artists, album, durationMs, artwork } = c
  return { videoId, title, artists, album, durationMs, artwork }
}

function fromSong(s: YtmSong, score: number): ResolveCandidate {
  return {
    input: `ytm:${s.videoId}`,
    source: 'ytm',
    title: s.title,
    artists: s.artists,
    album: s.album,
    durationMs: s.durationMs,
    artwork: s.artwork,
    score,
  }
}

const rank = (list: ResolveCandidate[]) => list.sort((a, b) => b.score - a.score)

function dedupe(list: ResolveCandidate[]): ResolveCandidate[] {
  const seen = new Set<string>()
  return list.filter((c) => !seen.has(c.input) && seen.add(c.input))
}
