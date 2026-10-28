import { getKv, setKv, type Db } from '../db'
import type { LinkProvider, OdesliStatus } from '../schemas'
import { parseLink, type TrackLink } from './links'
import { splitArtists } from './metadata'

const KEY = 'odesli_key'
const ENDPOINT = 'https://api.song.link/v1-alpha.1/links'
const TIMEOUT_MS = 8000

/** Odesli's name for each link provider's platform. */
const PLATFORM: Record<LinkProvider, string> = {
  spotify: 'spotify',
  apple: 'itunes',
  deezer: 'deezer',
  tidal: 'tidal',
  youtube: 'youtube',
  ytm: 'youtube',
}

/** What song.link knows about a track: its details, and where it is on YouTube Music. */
export interface OdesliMatch {
  title: string
  artists: string[]
  /** The videoId song.link links for YouTube Music, if it found one. */
  videoId: string | null
}

interface OdesliResponse {
  entityUniqueId?: string
  entitiesByUniqueId?: Record<string, { title?: string; artistName?: string }>
  linksByPlatform?: Record<string, { url?: string }>
}

/**
 * The Odesli (song.link) fallback of PLAN §5 step 4: asked only when the link's own
 * metadata and the matcher found nothing. Odesli no longer has a public API, so
 * this is off until an API key is set. The key is never returned to clients.
 */
export class OdesliClient {
  private lastError: string | null = null

  constructor(
    private readonly db: Db,
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  status(): OdesliStatus {
    return { configured: this.key() !== undefined, lastError: this.lastError }
  }

  /** Sets the API key, or turns the fallback off with `null`. */
  setKey(key: string | null): OdesliStatus {
    if (key) setKv(this.db, KEY, key)
    else this.db.prepare('DELETE FROM kv WHERE key = ?').run(KEY)
    this.lastError = null
    return this.status()
  }

  /**
   * What song.link knows about the linked track; undefined without a key, when it
   * doesn't know the track, or when it can't be reached (the error is kept for
   * `status()`, since a fallback failing shouldn't fail the resolve).
   */
  async lookup(link: TrackLink): Promise<OdesliMatch | undefined> {
    const key = this.key()
    if (!key) return undefined
    const query = new URLSearchParams({
      platform: PLATFORM[link.provider],
      type: 'song',
      id: link.id,
      key,
    })
    let res: Response
    try {
      res = await this.fetch(`${ENDPOINT}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
      // Not String(err): the error may quote the URL, which holds the key.
      this.lastError = `song.link could not be reached (${(err as Error).name})`
      return undefined
    }
    if (!res.ok) {
      this.lastError = await failure(res)
      return undefined
    }
    this.lastError = null
    const body = (await res.json()) as OdesliResponse
    const self = body.entityUniqueId ? body.entitiesByUniqueId?.[body.entityUniqueId] : undefined
    if (!self?.title) return undefined
    const links = body.linksByPlatform ?? {}
    const ytm = [links.youtubeMusic?.url, links.youtube?.url]
      .map((url) => (url ? parseLink(url) : undefined))
      .find((l) => l?.provider === 'ytm' || l?.provider === 'youtube')
    return {
      title: self.title,
      artists: splitArtists(self.artistName ?? ''),
      videoId: ytm?.id ?? null,
    }
  }

  private key(): string | undefined {
    return getKv(this.db, KEY) || undefined
  }
}

/** Why a song.link request failed, for the settings page. A 404 is no failure. */
async function failure(res: Response): Promise<string | null> {
  if (res.status === 404) return null
  const code = ((await res.json().catch(() => ({}))) as { code?: string }).code
  if (res.status === 401) return `song.link rejected the API key (${code ?? 'HTTP 401'})`
  if (res.status === 429) return 'song.link rate limit reached; try again later'
  if (res.status === 410) return 'song.link has retired this API version'
  return `song.link answered HTTP ${res.status}`
}
