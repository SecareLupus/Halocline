import { afterEach, describe, expect, it } from 'vitest'
import {
  createCore,
  DomainError,
  jaroWinkler,
  parseLink,
  scoreMatch,
  type Core,
  type YtmCatalog,
  type YtmSong,
} from '../src'

let core: Core | undefined
afterEach(() => core?.close())

const SPOTIFY_HTML = `<html><head>
<meta property="og:title" content="One More Time"/>
<meta property="og:description" content="Daft Punk · Discovery · Song · 2001"/>
<meta name="music:duration" content="320"/>
<meta name="music:musician_description" content="Daft Punk"/>
</head></html>`

const DEEZER_SEARCH = {
  data: [
    { title: 'One More Time', duration: 320, isrc: 'GBDUW0000053', artist: { name: 'Daft Punk' } },
    {
      title: 'One More Time (Short Radio Edit)',
      duration: 235,
      isrc: 'GBDUW0000054',
      artist: { name: 'Daft Punk' },
    },
  ],
}

/** A fake network: canned bodies by URL prefix, with a count of requests made. */
function fakeNetwork(routes: Record<string, string | object>) {
  const calls: string[] = []
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix))
    if (!key) return new Response('not found', { status: 404 })
    const body = routes[key]!
    return typeof body === 'string' ? new Response(body) : Response.json(body)
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const song = (
  videoId: string,
  title: string,
  durationMs: number,
  artists = ['Daft Punk'],
): YtmSong => ({
  videoId,
  title,
  artists,
  album: null,
  durationMs,
  artwork: `https://lh3.googleusercontent.com/${videoId}`,
})

/** YTM search returns `songs`; getSong also knows `videos` (uploads that aren't songs). */
function ytm(songs: YtmSong[], videos: YtmSong[] = []): YtmCatalog {
  return {
    status: () => ({ signedIn: false, account: null, playback: true, lastError: null }),
    refresh: async () => {},
    searchSongs: async () => songs,
    getSong: async (id) => [...songs, ...videos].find((s) => s.videoId === id),
    getRadio: async () => [],
  }
}

function setup(songs: YtmSong[], routes: Record<string, string | object>, videos: YtmSong[] = []) {
  const net = fakeNetwork(routes)
  core = createCore({ dbPath: ':memory:', ytm: ytm(songs, videos), fetch: net.fetch })
  return { core, calls: net.calls }
}

describe('parseLink', () => {
  it('recognises track links from each service, however they are written', () => {
    const cases: [string, string | undefined][] = [
      [
        'https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV?si=abc',
        'spotify:0DiWol3AO6WpXZgp0goxAV',
      ],
      [
        'https://open.spotify.com/intl-de/track/0DiWol3AO6WpXZgp0goxAV',
        'spotify:0DiWol3AO6WpXZgp0goxAV',
      ],
      ['spotify:track:0DiWol3AO6WpXZgp0goxAV', 'spotify:0DiWol3AO6WpXZgp0goxAV'],
      ['https://music.youtube.com/watch?v=fa5IWHDbftI&list=RD', 'ytm:fa5IWHDbftI'],
      ['https://www.youtube.com/watch?v=FGBhQbmPwH8&t=30', 'youtube:FGBhQbmPwH8'],
      ['https://youtu.be/FGBhQbmPwH8?si=x', 'youtube:FGBhQbmPwH8'],
      ['https://m.youtube.com/shorts/FGBhQbmPwH8', 'youtube:FGBhQbmPwH8'],
      ['https://tidal.com/browse/track/1781887', 'tidal:1781887'],
      ['https://listen.tidal.com/track/1781887', 'tidal:1781887'],
      ['https://music.apple.com/us/album/discovery/697194953?i=697195787', 'apple:697195787'],
      ['https://www.deezer.com/en/track/3135553', 'deezer:3135553'],
      ['https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc', undefined],
      ['https://example.com/track/1', undefined],
      ['daft punk', undefined],
    ]
    for (const [input, key] of cases) expect(parseLink(input)?.key, input).toBe(key)
  })
})

describe('scoring', () => {
  it('ignores video decorations and needs durations to agree', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3)
    const linked = {
      title: 'One More Time (Official Video)',
      artists: ['Daft Punk'],
      durationMs: 320_000,
    }
    expect(
      scoreMatch(linked, { title: 'One More Time', artists: ['Daft Punk'], durationMs: 321_000 }),
    ).toBe(1)
    expect(
      scoreMatch(linked, { title: 'One More Time', artists: ['Daft Punk'], durationMs: 235_000 }),
    ).toBe(0)
    // An extra version word is another recording.
    expect(
      scoreMatch(linked, {
        title: 'One More Time (Radio Edit)',
        artists: ['Daft Punk'],
        durationMs: 320_000,
      }),
    ).toBeLessThan(0.9)
    // Without a duration it can't be confirmed, so it can't be confident.
    expect(
      scoreMatch(
        { ...linked, durationMs: null },
        { title: 'One More Time', artists: ['Daft Punk'], durationMs: 1 },
      ),
    ).toBeLessThan(0.9)
  })
})

describe('link resolution', () => {
  it('matches a Spotify link to the library by ISRC, then answers from the cache', async () => {
    const { core, calls } = setup([], {
      'https://open.spotify.com/track/': SPOTIFY_HTML,
      'https://api.deezer.com/search': DEEZER_SEARCH,
    })
    const owned = core.library.create({
      title: 'One More Time (2001 Remaster)',
      artists: ['Daft Punk'],
      isrc: 'GBDUW0000053',
      inLibrary: true,
    })
    const link = 'https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV'
    const first = await core.catalog.preview(link)
    expect(first.link).toMatchObject({
      provider: 'spotify',
      isrc: 'GBDUW0000053',
      durationMs: 320_000,
    })
    expect(first.match).toMatchObject({ source: 'library', input: owned.id, score: 1 })

    const requests = calls.length
    const again = await core.catalog.resolve(`${link}?si=share`)
    expect(again.id).toBe(owned.id)
    expect(calls).toHaveLength(requests)
  })

  it('finds the YouTube Music song for a Spotify link and adds it on enqueue', async () => {
    const { core } = setup(
      [
        song('fa5IWHDbftI', 'One More Time', 321_000),
        song('wU26xVT_vBU', 'One More Time (Radio Edit)', 235_000),
      ],
      {
        'https://open.spotify.com/track/': SPOTIFY_HTML,
        'https://api.deezer.com/search': DEEZER_SEARCH,
      },
    )
    const recording = await core.catalog.resolve(
      'https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV',
    )
    expect(recording).toMatchObject({ title: 'One More Time', inLibrary: false })
    expect(core.library.sources(recording.id)).toMatchObject([
      { kind: 'ytm', locator: 'fa5IWHDbftI' },
    ])
  })

  it('maps a YouTube upload to its song, or plays the video itself when there is none', async () => {
    const upload = song('XXXXXXXXXXX', 'Daft Punk - One More Time (Official Video)', 322_000, [
      'DaftPunkVEVO',
    ])
    const { core } = setup([song('fa5IWHDbftI', 'One More Time', 321_000)], {}, [upload])
    const mapped = await core.catalog.preview('https://youtu.be/XXXXXXXXXXX')
    expect(mapped.link).toMatchObject({
      title: 'One More Time (Official Video)',
      artists: ['Daft Punk'],
    })
    expect(mapped.match?.input).toBe('ytm:fa5IWHDbftI')
    expect(mapped.candidates.map((c) => c.input)).toContain('ytm:XXXXXXXXXXX')

    const rare = song('YYYYYYYYYYY', 'Someone - Live at the Pub', 200_000, ['Someone'])
    const { core: other } = setup([], {}, [rare])
    expect((await other.catalog.preview('https://youtu.be/YYYYYYYYYYY')).match?.input).toBe(
      'ytm:YYYYYYYYYYY',
    )
    await other.close()
  })

  it('keeps a linked YouTube Music song rather than another release of it', async () => {
    const { core } = setup(
      [
        song('compilation', 'One More Time', 320_500),
        song('fa5IWHDbftI', 'One More Time', 321_000),
      ],
      {},
    )
    const r = await core.catalog.preview('https://music.youtube.com/watch?v=fa5IWHDbftI')
    expect(r.match?.input).toBe('ytm:fa5IWHDbftI')
  })

  it('returns candidates instead of guessing when nothing is confident', async () => {
    const tidal = '<meta property="og:title" content="Daft Punk - One More Time">'
    const { core } = setup([song('fa5IWHDbftI', 'One More Time', 321_000)], {
      'https://tidal.com/browse/track/': tidal,
    })
    const err = await core.catalog
      .resolve('https://tidal.com/browse/track/1')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err).toMatchObject({
      type: 'match_ambiguous',
      details: { candidates: [{ input: 'ytm:fa5IWHDbftI', source: 'ytm' }] },
    })
  })

  it('reports unsupported links and dead links', async () => {
    const { core } = setup([], {})
    await expect(core.catalog.resolve('https://example.com/song/1')).rejects.toMatchObject({
      type: 'not_implemented',
    })
    await expect(
      core.catalog.resolve('https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV'),
    ).rejects.toMatchObject({ type: 'not_found' })
  })
})
