import {
  createCore,
  type Core,
  type NewRecording,
  type YtmCatalog,
  type YtmSong,
  type YtmStatus,
} from '../src'

/** An in-memory core. `ytmPlayback` pretends a YTM engine exists, for player tests. */
export function testCore(options: { ytmPlayback?: boolean } = {}): Core {
  return createCore({
    dbPath: ':memory:',
    ytm: fakeYtm([], { playback: options.ytmPlayback ?? false }),
    autoplay: false,
  })
}

export function song(core: Core, title: string, extra: Partial<NewRecording> = {}) {
  return core.library.create({ title, artists: ['Test Artist'], inLibrary: true, ...extra })
}

/** An offline YTM catalog with a fixed song list. */
export function fakeYtm(
  songs: YtmSong[] = [],
  options: { playback?: boolean; down?: boolean; radio?: Record<string, YtmSong[]> } = {},
): YtmCatalog {
  const status: YtmStatus = {
    signedIn: false,
    account: null,
    accountId: null,
    playback: options.playback ?? false,
    lastError: null,
  }
  return {
    status: () => status,
    refresh: async () => {},
    searchSongs: async (q) => {
      if (options.down) throw new Error('offline')
      return songs.filter((s) => s.title.toLowerCase().includes(q.toLowerCase()))
    },
    getSong: async (id) => songs.find((s) => s.videoId === id),
    accounts: async () => [],
    selectAccount: async () => status,
    getRadio: async (id) => {
      if (options.down) throw new Error('offline')
      return options.radio?.[id] ?? []
    },
  }
}

export const ytmSong = (videoId: string, title: string): YtmSong => ({
  videoId,
  title,
  artists: ['Cloud Artist'],
  album: 'Cloud Album',
  durationMs: 200_000,
  artwork: `https://lh3.googleusercontent.com/${videoId}=w544-h544`,
})
