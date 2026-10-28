import { Innertube, YTNodes } from 'youtubei.js'
import type { EventBus } from '../events'
import { DomainError } from '../errors'
import type { YtmAccount, YtmCollection, YtmCollectionDetail, YtmSong, YtmStatus } from '../schemas'

/** What the rest of the core needs from YouTube Music. Tests supply a fake. */
export interface YtmCatalog {
  status(): YtmStatus
  searchSongs(query: string, limit?: number): Promise<YtmSong[]>
  getSong(videoId: string): Promise<YtmSong | undefined>
  /** YTM's radio for a song (its up-next list), best first, without the song itself. */
  getRadio(videoId: string): Promise<YtmSong[]>
  /** Albums or playlists matching a search. */
  searchCollections(
    query: string,
    kind: YtmCollection['kind'],
    limit?: number,
  ): Promise<YtmCollection[]>
  /** An album's or playlist's tracks; undefined if YouTube Music has no such thing. */
  getCollection(ref: string): Promise<YtmCollectionDetail | undefined>
  /** Rebuilds the session, e.g. after signing in or out. */
  refresh(): Promise<void>
  /** The channels the signed-in account can use; empty when signed out. */
  accounts(): Promise<YtmAccount[]>
  /** Uses one of `accounts()` from now on; null goes back to the Google account's own. */
  selectAccount(id: string | null): Promise<YtmStatus>
}

/** Which Google account (of those signed in) and which of its channels requests run as. */
export interface YtmIdentity {
  /** `X-Goog-AuthUser`: the Google account's index in the session. */
  authUser: number
  /** A brand channel's page ID, or null for the account's own channel. */
  pageId: string | null
}

/** "0" for the first account's own channel, "0:<pageId>" for one of its brand channels. */
export function parseAccountId(id: string | null): YtmIdentity {
  const match = id ? /^(\d+)(?::([\w-]+))?$/.exec(id) : null
  return { authUser: Number(match?.[1] ?? 0), pageId: match?.[2] ?? null }
}

const accountId = (identity: YtmIdentity) =>
  identity.pageId ? `${identity.authUser}:${identity.pageId}` : String(identity.authUser)

/** youtubei.js session options for an identity. */
export const identityOptions = (identity: YtmIdentity) => ({
  account_index: identity.authUser,
  ...(identity.pageId && { on_behalf_of_user: identity.pageId }),
})

/**
 * One entry of YouTube's channel switcher as a choice. Its endpoint carries the
 * brand channel's page ID (none for the account's own channel) and a sign-in URL
 * whose `authuser` says which Google account it belongs to.
 */
export function toYtmAccount(item: {
  name: string
  handle: string
  photo: string | undefined
  selected: boolean
  tokens: Record<string, Record<string, unknown> | undefined>[]
}): YtmAccount | undefined {
  const token = (kind: string) => item.tokens.find((t) => t[kind])?.[kind]
  const pageId = token('pageIdToken')?.['pageId']
  const signinUrl = token('accountSigninToken')?.['signinUrl']
  const switchUrl =
    typeof signinUrl === 'string' ? new URL(signinUrl, 'https://www.youtube.com').toString() : null
  const authUser = Number(switchUrl ? new URL(switchUrl).searchParams.get('authuser') : 0) || 0
  if (!item.name) return undefined
  return {
    id: accountId({ authUser, pageId: typeof pageId === 'string' ? pageId : null }),
    name: item.name,
    handle: item.handle || null,
    photo: item.photo ?? null,
    selected: item.selected,
    switchUrl,
  }
}

export interface YtmProviderOptions {
  /** Cookie header for music.youtube.com from the signed-in session, if any. */
  cookie?: () => Promise<string | undefined>
  /** Where the chosen channel's `YtmAccount.id` is kept between runs. */
  account?: { get(): string | null; set(id: string | null): void }
  /** Whether a playback engine is attached; without one YTM tracks are skipped. */
  playback?: boolean
}

const VIDEO_ID = /^[\w-]{11}$/

/** Long playlists are read in pages; this many tracks is plenty for a queue. */
export const MAX_COLLECTION_SONGS = 500

const COLLECTION_REF = /^ytm-(album|playlist):([\w-]+)$/

/** `ytm-album:<browseId>` or `ytm-playlist:<playlistId>`, split; undefined for anything else. */
export function parseCollectionRef(
  ref: string,
): { kind: YtmCollection['kind']; id: string } | undefined {
  const match = COLLECTION_REF.exec(ref.trim())
  return match ? { kind: match[1] as YtmCollection['kind'], id: match[2]! } : undefined
}

/** Google thumbnail URLs carry their size; ask for a larger square. */
export function upscaleArtwork(url: string | undefined): string | null {
  if (!url) return null
  return url.replace(/=w\d+-h\d+/, '=w544-h544')
}

/**
 * The name of the account requests run as. YouTube's account list also holds the
 * family's other profiles (supervised and YouTube Kids ones come first), so it's
 * the one marked selected, not the first.
 */
export function activeAccountName(items: { name: string; selected: boolean }[]): string | null {
  const active = items.find((i) => i.selected) ?? (items.length === 1 ? items[0] : undefined)
  return active?.name || null
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
      accountId: options.account?.get() ?? null,
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
    let accountId = this.options.account?.get() ?? null
    if (!signedIn && accountId) {
      // Whoever signs in next may have other channels.
      this.options.account?.set(null)
      accountId = null
    }
    if (signedIn) {
      try {
        const choices = await this.accounts()
        // A channel that's gone (or another Google account signed in) falls back to the default.
        if (accountId && !choices.some((c) => c.id === accountId)) {
          this.options.account?.set(null)
          accountId = null
          this.session = null
        }
        account =
          choices.find((c) => c.id === accountId)?.name ??
          activeAccountName(choices.map((c) => ({ name: c.name, selected: c.selected })))
      } catch {
        // The name is cosmetic; signed-in cookies are what count.
      }
    }
    this.setStatus({ signedIn, account, accountId })
  }

  async accounts(): Promise<YtmAccount[]> {
    if (!isSignedIn(await this.options.cookie?.())) return []
    return this.guard(async () => {
      const items = await (await this.innertube()).account.getInfo(true)
      return items.flatMap(
        (item) =>
          toYtmAccount({
            name: item.account_name.toString(),
            handle: item.channel_handle.toString(),
            photo: item.account_photo[0]?.url,
            selected: item.is_selected,
            tokens: ((item.endpoint.payload as { supportedTokens?: [] } | undefined)
              ?.supportedTokens ?? []) as Record<string, Record<string, unknown>>[],
          }) ?? [],
      )
    })
  }

  async selectAccount(id: string | null): Promise<YtmStatus> {
    if (id !== null && !(await this.accounts()).some((a) => a.id === id)) {
      throw new DomainError('not_found', `No YouTube Music channel ${id} for this account`)
    }
    this.options.account?.set(id)
    await this.refresh()
    return this.current
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

  async getRadio(videoId: string): Promise<YtmSong[]> {
    if (!VIDEO_ID.test(videoId)) return []
    return this.guard(async () => {
      const panel = await (await this.innertube()).music.getUpNext(videoId, true)
      const songs: YtmSong[] = []
      for (const node of panel.contents) {
        // A wrapper pairs a song with its music video; the primary is the one queued.
        const item = node.is(YTNodes.PlaylistPanelVideoWrapper)
          ? node.primary
          : node.is(YTNodes.PlaylistPanelVideo)
            ? node
            : null
        if (!item || item.video_id === videoId || !VIDEO_ID.test(item.video_id)) continue
        songs.push({
          videoId: item.video_id,
          title: item.title.toString() || 'Untitled',
          artists: item.artists?.map((a) => a.name).filter(Boolean) ?? [item.author],
          album: item.album?.name ?? null,
          durationMs: item.duration?.seconds ? item.duration.seconds * 1000 : null,
          artwork: upscaleArtwork(item.thumbnail?.[0]?.url),
        })
      }
      return songs
    })
  }

  async searchCollections(
    query: string,
    kind: YtmCollection['kind'],
    limit = 8,
  ): Promise<YtmCollection[]> {
    return this.guard(async () => {
      const search = await (await this.innertube()).music.search(query, { type: kind })
      const items = (search.contents?.filterType(YTNodes.MusicShelf) ?? []).flatMap((s) => [
        ...s.contents,
      ])
      return items
        .filter((item) => item.item_type === kind && item.id)
        .slice(0, limit)
        .map((item) => ({
          ref: `ytm-${kind}:${item.id}`,
          kind,
          title: item.title ?? 'Untitled',
          by: item.author?.name ?? item.artists?.map((a) => a.name).join(', ') ?? null,
          year: item.year ?? null,
          artwork: upscaleArtwork(item.thumbnails?.[0]?.url),
        }))
    })
  }

  async getCollection(ref: string): Promise<YtmCollectionDetail | undefined> {
    const parsed = parseCollectionRef(ref)
    if (!parsed) return undefined
    return this.guard(async () => {
      const yt = await this.innertube()
      if (parsed.kind === 'album') {
        const album = await yt.music.getAlbum(parsed.id)
        const header = album.header as
          | {
              title?: unknown
              strapline_text_one?: unknown
              subtitle?: unknown
              thumbnail?: { contents?: { url: string }[] }
            }
          | undefined
        const title = header?.title ? String(header.title) : 'Untitled album'
        const by = header?.strapline_text_one ? String(header.strapline_text_one) : null
        const year =
          /\b(\d{4})\b/.exec(header?.subtitle ? String(header.subtitle) : '')?.[1] ?? null
        const artwork = upscaleArtwork(header?.thumbnail?.contents?.[0]?.url)
        // Album tracks carry neither artist nor art: both come from the album.
        const songs = album.contents.flatMap((t): YtmSong[] =>
          t.id && VIDEO_ID.test(t.id)
            ? [
                {
                  videoId: t.id,
                  title: t.title ?? 'Untitled',
                  artists: t.artists?.length ? t.artists.map((a) => a.name) : by ? [by] : [],
                  album: title,
                  durationMs: t.duration?.seconds ? t.duration.seconds * 1000 : null,
                  artwork,
                },
              ]
            : [],
        )
        return { ref, kind: 'album', title, by, year, artwork, songs }
      }
      let page = await yt.music.getPlaylist(parsed.id)
      const header = page.header as { title?: unknown; subtitle?: unknown } | undefined
      // An album shared as a playlist (OLAK5uy_…) comes without a header; its tracks
      // name the album, which has the title, artist, year and art.
      const albumId = (page.items?.[0] as YTNodes.MusicResponsiveListItem | undefined)?.album?.id
      if (!header?.title && /^(VL)?OLAK5uy_/.test(parsed.id) && albumId?.startsWith('MPREb_')) {
        return this.getCollection(`ytm-album:${albumId}`)
      }
      const items = [...(page.items ?? [])]
      while (page.has_continuation && items.length < MAX_COLLECTION_SONGS) {
        page = await page.getContinuation()
        items.push(...(page.items ?? []))
      }
      const songs = items.slice(0, MAX_COLLECTION_SONGS).flatMap((t): YtmSong[] => {
        const item = t as YTNodes.MusicResponsiveListItem
        if (!item.id || !VIDEO_ID.test(item.id)) return []
        const artists = (item.artists ?? item.authors ?? []).map((a) => a.name).filter(Boolean)
        return [
          {
            videoId: item.id,
            title: item.title ?? 'Untitled',
            artists,
            album: item.album?.name ?? null,
            durationMs: item.duration?.seconds ? item.duration.seconds * 1000 : null,
            artwork: upscaleArtwork(item.thumbnail?.contents?.[0]?.url),
          },
        ]
      })
      return {
        ref,
        kind: 'playlist',
        title: header?.title ? String(header.title) : 'Untitled playlist',
        by: null,
        year: null,
        artwork: songs[0]?.artwork ?? null,
        songs,
      }
    })
  }

  private innertube(): Promise<Innertube> {
    this.session ??= (async () => {
      const cookie = await this.options.cookie?.()
      const signedIn = isSignedIn(cookie)
      return Innertube.create({
        retrieve_player: false,
        ...(signedIn && {
          cookie,
          ...identityOptions(parseAccountId(this.options.account?.get() ?? null)),
        }),
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
