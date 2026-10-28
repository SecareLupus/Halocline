import type { LinkProvider } from '../schemas'

/** A track link reduced to what identifies it. */
export interface TrackLink {
  provider: LinkProvider
  /** The provider's track ID (a videoId for YouTube and YouTube Music). */
  id: string
  /** Stable cache key: the same track gives the same key however the URL is written. */
  key: string
}

const YOUTUBE_ID = /^[\w-]{11}$/
const link = (provider: LinkProvider, id: string): TrackLink => ({
  provider,
  id,
  key: `${provider}:${id}`,
})

/**
 * Recognises track links from the services in PLAN §5. Anything else (album
 * links, playlists, unknown sites) gives undefined.
 */
export function parseLink(input: string): TrackLink | undefined {
  const spotifyUri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(input.trim())
  if (spotifyUri) return link('spotify', spotifyUri[1]!)

  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
  const path = url.pathname.split('/').filter(Boolean)

  switch (host) {
    case 'music.youtube.com':
    case 'youtube.com': {
      const provider = host === 'music.youtube.com' ? 'ytm' : 'youtube'
      const v = url.searchParams.get('v')
      if (path[0] === 'watch' && v && YOUTUBE_ID.test(v)) return link(provider, v)
      if ((path[0] === 'shorts' || path[0] === 'live') && path[1] && YOUTUBE_ID.test(path[1])) {
        return link(provider, path[1])
      }
      return undefined
    }
    case 'youtu.be':
      return path[0] && YOUTUBE_ID.test(path[0]) ? link('youtube', path[0]) : undefined
    case 'open.spotify.com': {
      // open.spotify.com/track/ID or /intl-de/track/ID
      const at = path.indexOf('track')
      const id = at >= 0 ? path[at + 1] : undefined
      return id && /^[A-Za-z0-9]{22}$/.test(id) ? link('spotify', id) : undefined
    }
    case 'tidal.com':
    case 'listen.tidal.com': {
      const at = path.indexOf('track')
      const id = at >= 0 ? path[at + 1] : undefined
      return id && /^\d+$/.test(id) ? link('tidal', id) : undefined
    }
    case 'music.apple.com': {
      // music.apple.com/us/album/slug/123?i=456 (a track on an album) or /us/song/slug/456
      const track = url.searchParams.get('i')
      if (track && /^\d+$/.test(track)) return link('apple', track)
      const id = path[1] === 'song' ? path[3] : undefined
      return id && /^\d+$/.test(id) ? link('apple', id) : undefined
    }
    case 'deezer.com': {
      const at = path.indexOf('track')
      const id = at >= 0 ? path[at + 1] : undefined
      return id && /^\d+$/.test(id) ? link('deezer', id) : undefined
    }
    default:
      return undefined
  }
}

export const looksLikeUrl = (s: string) => /^(https?:\/\/|spotify:)/i.test(s.trim())
