import { DomainError } from '../errors'
import type { YtmCatalog } from '../providers/ytm'
import type { LinkMetadata } from '../schemas'
import type { TrackLink } from './links'
import { CONFIDENT, scoreMatch } from './score'

export interface MetadataDeps {
  fetch: typeof globalThis.fetch
  ytm: YtmCatalog
}

/**
 * Identifies itself honestly: Spotify and Tidal give link-preview tags (title,
 * artist, duration) to clients like this, and only a script shell to browsers.
 */
const USER_AGENT = 'Halocline/0.2.0 (link preview; +https://github.com/SecareLupus/Halocline)'
const TIMEOUT_MS = 8000
/** The score of a perfect title and artist when one side has no duration. */
const EXACT_WITHOUT_DURATION = 0.85

/** Reads what a track link points at, from that service's public metadata (PLAN §5). */
export async function readLink(link: TrackLink, deps: MetadataDeps): Promise<LinkMetadata> {
  switch (link.provider) {
    case 'ytm':
    case 'youtube':
      return readYouTube(link, deps.ytm)
    case 'spotify':
      return readSpotify(link.id, deps.fetch)
    case 'tidal':
      return readTidal(link.id, deps.fetch)
    case 'apple':
      return readApple(link.id, deps.fetch)
    case 'deezer':
      return readDeezer(link.id, deps.fetch)
  }
}

/**
 * Fills in a missing ISRC (and duration) from Deezer's public search, so the
 * match can be exact. Leaves the metadata alone if Deezer has no confident match
 * or can't be reached: this only ever improves a match.
 */
export async function enrichFromDeezer(
  meta: LinkMetadata,
  fetch: typeof globalThis.fetch,
): Promise<LinkMetadata> {
  if (meta.isrc && meta.durationMs !== null) return meta
  try {
    const q = encodeURIComponent(`${meta.artists[0] ?? ''} ${meta.title}`.trim())
    const res = (await getJson(`https://api.deezer.com/search?q=${q}&limit=10`, fetch)) as {
      data?: DeezerTrack[]
    }
    let best: { track: DeezerTrack; score: number } | undefined
    for (const track of res.data ?? []) {
      const score = scoreMatch(meta, fromDeezer(track))
      if (!best || score > best.score) best = { track, score }
    }
    // Without a duration nothing scores confident, so take an exact title and artist
    // (Deezer ranks the original release first); that's what supplies the duration.
    const needed = meta.durationMs === null ? EXACT_WITHOUT_DURATION : CONFIDENT
    if (!best || best.score < needed) return meta
    const found = fromDeezer(best.track)
    return {
      ...meta,
      isrc: meta.isrc ?? found.isrc,
      durationMs: meta.durationMs ?? found.durationMs,
    }
  } catch {
    return meta
  }
}

async function readYouTube(link: TrackLink, ytm: YtmCatalog): Promise<LinkMetadata> {
  let song
  try {
    song = await ytm.getSong(link.id)
  } catch (err) {
    throw new DomainError('provider_unavailable', `YouTube lookup failed: ${String(err)}`)
  }
  if (!song) throw new DomainError('not_found', `YouTube has no video ${link.id}`)
  // YouTube uploads are often titled "Artist - Title (Official Video)" on a channel named
  // otherwise. YouTube Music's own titles are already clean ("Song - Remastered" is a title).
  const split = link.provider === 'youtube' ? /^(.+?)\s+[-–—]\s+(.+)$/.exec(song.title) : null
  return {
    provider: link.provider,
    title: split ? split[2]! : song.title,
    artists: split ? splitArtists(split[1]!) : song.artists,
    album: song.album,
    durationMs: song.durationMs,
    isrc: null,
  }
}

async function readSpotify(id: string, fetch: typeof globalThis.fetch): Promise<LinkMetadata> {
  const html = await getText(`https://open.spotify.com/track/${id}`, fetch)
  const title = meta(html, 'og:title')
  if (!title) throw new DomainError('not_found', `Spotify has no track ${id}`)
  // og:description is "Artist, Artist · Album · Song · 2001"
  const parts = (meta(html, 'og:description') ?? '').split(' · ')
  const artists = meta(html, 'music:musician_description') ?? parts[0] ?? ''
  const seconds = Number(meta(html, 'music:duration'))
  return {
    provider: 'spotify',
    title,
    artists: artists.split(', ').filter(Boolean),
    album: parts.length >= 3 ? (parts[1] ?? null) : null,
    durationMs: seconds > 0 ? seconds * 1000 : null,
    isrc: null,
  }
}

async function readTidal(id: string, fetch: typeof globalThis.fetch): Promise<LinkMetadata> {
  const html = await getText(`https://tidal.com/browse/track/${id}`, fetch)
  // og:title is "Artist - Title"; titles contain " - " more often than artist names do.
  const ogTitle = meta(html, 'og:title')
  const split = ogTitle && /^(.+?) - (.+)$/.exec(ogTitle)
  if (!split) throw new DomainError('not_found', `Tidal has no track ${id}`)
  return {
    provider: 'tidal',
    title: split[2]!,
    artists: splitArtists(split[1]!),
    album: null,
    durationMs: null,
    isrc: null,
  }
}

async function readApple(id: string, fetch: typeof globalThis.fetch): Promise<LinkMetadata> {
  const res = (await getJson(`https://itunes.apple.com/lookup?id=${id}&entity=song`, fetch)) as {
    results?: {
      wrapperType?: string
      trackName?: string
      artistName?: string
      collectionName?: string
      trackTimeMillis?: number
    }[]
  }
  const track = res.results?.find((r) => r.wrapperType === 'track' && r.trackName)
  if (!track?.trackName) throw new DomainError('not_found', `Apple Music has no song ${id}`)
  return {
    provider: 'apple',
    title: track.trackName,
    artists: splitArtists(track.artistName ?? ''),
    album: track.collectionName ?? null,
    durationMs: track.trackTimeMillis ?? null,
    isrc: null,
  }
}

async function readDeezer(id: string, fetch: typeof globalThis.fetch): Promise<LinkMetadata> {
  const track = (await getJson(`https://api.deezer.com/track/${id}`, fetch)) as DeezerTrack & {
    error?: unknown
  }
  if (track.error || !track.title) throw new DomainError('not_found', `Deezer has no track ${id}`)
  return { provider: 'deezer', ...fromDeezer(track) }
}

interface DeezerTrack {
  title?: string
  duration?: number
  isrc?: string
  artist?: { name?: string }
  contributors?: { name?: string }[]
  album?: { title?: string }
}

function fromDeezer(t: DeezerTrack): Omit<LinkMetadata, 'provider'> {
  const names = t.contributors?.map((c) => c.name).filter((n): n is string => Boolean(n))
  return {
    title: t.title ?? '',
    artists: names?.length ? names : t.artist?.name ? [t.artist.name] : [],
    album: t.album?.title ?? null,
    durationMs: t.duration ? t.duration * 1000 : null,
    isrc: t.isrc ?? null,
  }
}

/**
 * "A, B feat. C" → ["A", "B", "C"]. "&" and "x" stay: they're part of names as
 * often as joins ("Simon & Garfunkel"), and matching takes the best artist pair.
 */
function splitArtists(text: string): string[] {
  return text
    .split(/\s*(?:,|\bfeat\.|\bft\.|\bfeaturing\b)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean)
}

async function getText(url: string, fetch: typeof globalThis.fetch): Promise<string> {
  return (await request(url, fetch)).text()
}

async function getJson(url: string, fetch: typeof globalThis.fetch): Promise<unknown> {
  return (await request(url, fetch)).json()
}

async function request(url: string, fetch: typeof globalThis.fetch): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new DomainError('provider_unavailable', `${new URL(url).hostname}: ${String(err)}`)
  }
  if (res.status === 404) throw new DomainError('not_found', `${url} was not found`)
  if (!res.ok) {
    throw new DomainError('provider_unavailable', `${new URL(url).hostname}: HTTP ${res.status}`)
  }
  return res
}

/** The content of a `<meta property|name="…">` tag, HTML entities decoded. */
function meta(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tag = new RegExp(`<meta\\s+(?:property|name)="${escaped}"\\s+content="([^"]*)"`, 'i')
  const value = tag.exec(html)?.[1]
  return value === undefined ? undefined : decodeEntities(value)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
