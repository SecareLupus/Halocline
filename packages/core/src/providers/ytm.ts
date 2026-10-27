import { Innertube, YTNodes } from 'youtubei.js'
import type { EventBus } from '../events'
import type { YtmSong, YtmStatus } from '../schemas'

/** What the rest of the core needs from YouTube Music. Tests supply a fake. */
export interface YtmCatalog {
  status(): YtmStatus
  searchSongs(query: string, limit?: number): Promise<YtmSong[]>
  getSong(videoId: string): Promise<YtmSong | undefined>
  /** Rebuilds the session, e.g. after signing in or out. */
  refresh(): Promise<void>
}

export interface YtmProviderOptions {
  /** Cookie header for music.youtube.com from the signed-in session, if any. */
  cookie?: () => Promise<string | undefined>
  /** Whether a playback engine is attached; without one YTM tracks are skipped. */
  playback?: boolean
}

const VIDEO_ID = /^[\w-]{11}$/

/** Google thumbnail URLs carry their size; ask for a larger square. */
export function upscaleArtwork(url: string | undefined): string | null {
  if (!url) return null
  return url.replace(/=w\d+-h\d+/, '=w544-h544')
}

/** Cookies that mean a Google account is signed in on this session. */
const isSignedIn = (cookie: string | undefined) =>
  Boolean(cookie && /(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=/.test(cookie))

/**
 * YouTube Music search and song metadata through InnerTube (youtubei.js).
 * Search and metadata need no player JavaScript, so none is fetched or run.
 */
export class YtmProvider implements YtmCatalog {
  private session: Promise<Innertube> | null = null
  private current: YtmStatus

  constructor(
    private readonly events: EventBus,
    private readonly options: YtmProviderOptions = {},
  ) {
    this.current = {
      signedIn: false,
      account: null,
      playback: options.playback ?? false,
      lastError: null,
    }
  }

  status(): YtmStatus {
    return this.current
  }

  async refresh(): Promise<void> {
    this.session = null
    const cookie = await this.options.cookie?.()
    const signedIn = isSignedIn(cookie)
    let account: string | null = null
    if (signedIn) {
      try {
        const info = await (await this.innertube()).account.getInfo()
        const item = info.contents?.contents.firstOfType(YTNodes.AccountItem)
        account = item?.account_name.toString() || null
      } catch {
        // The name is cosmetic; signed-in cookies are what count.
      }
    }
    this.setStatus({ signedIn, account })
  }

  async searchSongs(query: string, limit = 20): Promise<YtmSong[]> {
    return this.guard(async () => {
      const search = await (await this.innertube()).music.search(query, { type: 'song' })
      const items = (search.contents?.filterType(YTNodes.MusicShelf) ?? []).flatMap((s) => [
        ...s.contents,
      ])
      const songs: YtmSong[] = []
      for (const item of items) {
        if (item.item_type !== 'song' || !item.id || !VIDEO_ID.test(item.id)) continue
        songs.push({
          videoId: item.id,
          title: item.title ?? 'Untitled',
          artists: item.artists?.map((a) => a.name).filter(Boolean) ?? [],
          album: item.album?.name ?? null,
          durationMs: item.duration?.seconds ? item.duration.seconds * 1000 : null,
          artwork: upscaleArtwork(item.thumbnails?.[0]?.url),
        })
        if (songs.length >= limit) break
      }
      return songs
    })
  }

  async getSong(videoId: string): Promise<YtmSong | undefined> {
    if (!VIDEO_ID.test(videoId)) return undefined
    return this.guard(async () => {
      const info = await (await this.innertube()).music.getInfo(videoId)
      const basic = info.basic_info
      if (!basic.title) return undefined
      return {
        videoId,
        title: basic.title,
        artists: basic.author ? [basic.author.replace(/ - Topic$/, '')] : [],
        album: null,
        durationMs: basic.duration ? basic.duration * 1000 : null,
        artwork: upscaleArtwork(basic.thumbnail?.[0]?.url),
      }
    })
  }

  private innertube(): Promise<Innertube> {
    this.session ??= (async () => {
      const cookie = await this.options.cookie?.()
      return Innertube.create({
        retrieve_player: false,
        ...(isSignedIn(cookie) && { cookie }),
      })
    })().catch((err: unknown) => {
      this.session = null
      throw err
    })
    return this.session
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      const result = await work()
      if (this.current.lastError) this.setStatus({ lastError: null })
      return result
    } catch (err) {
      this.setStatus({ lastError: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  private setStatus(changes: Partial<YtmStatus>): void {
    this.current = { ...this.current, ...changes }
    this.events.publish({ type: 'ytm.changed', data: this.current })
  }
}
