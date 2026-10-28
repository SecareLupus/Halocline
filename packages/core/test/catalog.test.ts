import { afterEach, describe, expect, it } from 'vitest'
import { activeAccountName, createCore, parseYtmRef, upscaleArtwork, type Core } from '../src'
import { fakeYtm, ytmSong } from './helpers'

let core: Core | undefined
afterEach(() => core?.close())

const SONGS = [ytmSong('aaaaaaaaaaa', 'Halo Song'), ytmSong('bbbbbbbbbbb', 'Halo Other')]

describe('parseYtmRef', () => {
  it('accepts ytm: refs only; links go through the resolver', () => {
    expect(parseYtmRef('ytm:aaaaaaaaaaa')).toBe('aaaaaaaaaaa')
    expect(parseYtmRef('https://music.youtube.com/watch?v=fa5IWHDbftI&si=x')).toBeUndefined()
    expect(parseYtmRef('https://www.youtube.com/watch?v=fa5IWHDbftI')).toBeUndefined()
    expect(parseYtmRef('ytm:short')).toBeUndefined()
  })
  it('names the account requests run as, not the family profiles listed before it', () => {
    // As YouTube's TV account list returns it for a parent with children's profiles.
    const items = [
      { name: 'Keaton', selected: false },
      { name: 'Amari', selected: false },
      { name: 'Desmond Duval', selected: true },
    ]
    expect(activeAccountName(items)).toBe('Desmond Duval')
    expect(activeAccountName([{ name: 'Solo', selected: false }])).toBe('Solo')
    expect(activeAccountName(items.map((i) => ({ ...i, selected: false })))).toBeNull()
  })
  it('upscales Google thumbnail URLs', () => {
    expect(upscaleArtwork('https://lh3.googleusercontent.com/x=w120-h120-l90-rj')).toBe(
      'https://lh3.googleusercontent.com/x=w544-h544-l90-rj',
    )
  })
})

describe('CatalogService', () => {
  it('puts library results first and hides YTM songs already in them', async () => {
    core = createCore({ dbPath: ':memory:', ytm: fakeYtm(SONGS) })
    const local = core.library.create({
      title: 'Halo Song',
      artists: ['Cloud Artist'],
      inLibrary: true,
    })
    core.library.addSource(local.id, { kind: 'ytm', locator: 'aaaaaaaaaaa' })

    const results = await core.catalog.search('halo')
    expect(results.map((r) => r.kind)).toEqual(['library', 'ytm'])
    expect(results[1]).toMatchObject({ ref: 'ytm:bbbbbbbbbbb', song: { title: 'Halo Other' } })
    expect((await core.catalog.search('halo', 'library')).map((r) => r.kind)).toEqual(['library'])
  })

  it('lists queued YTM songs outside the library as YTM results, not library ones', async () => {
    core = createCore({ dbPath: ':memory:', ytm: fakeYtm(SONGS) })
    await core.catalog.resolve('ytm:aaaaaaaaaaa') // queued once, never saved
    const results = await core.catalog.search('halo')
    expect(results.map((r) => r.kind)).toEqual(['ytm', 'ytm'])
  })

  it('still returns library results when YTM is down, and 503s when there are none', async () => {
    core = createCore({ dbPath: ':memory:', ytm: fakeYtm(SONGS, { down: true }) })
    core.library.create({ title: 'Halo Local', artists: [], inLibrary: true })
    expect(await core.catalog.search('halo')).toHaveLength(1)
    await expect(core.catalog.search('nothing')).rejects.toMatchObject({
      type: 'provider_unavailable',
    })
  })

  it('resolves YTM refs to one recording per song, outside the library', async () => {
    core = createCore({ dbPath: ':memory:', ytm: fakeYtm(SONGS) })
    const a = await core.catalog.resolve('ytm:aaaaaaaaaaa')
    const again = await core.catalog.resolve('https://music.youtube.com/watch?v=aaaaaaaaaaa')
    expect(again.id).toBe(a.id)
    expect(a).toMatchObject({ title: 'Halo Song', inLibrary: false, durationMs: 200_000 })
    expect(core.library.sources(a.id)).toEqual([
      expect.objectContaining({ kind: 'ytm', locator: 'aaaaaaaaaaa' }),
    ])
    await expect(core.catalog.resolve('ytm:zzzzzzzzzzz')).rejects.toMatchObject({
      type: 'not_found',
    })
    await expect(core.catalog.resolve('https://open.spotify.com/track/1')).rejects.toMatchObject({
      type: 'not_implemented',
    })
  })

  it('skips YTM songs at play time until a YTM engine exists', async () => {
    core = createCore({ dbPath: ':memory:', ytm: fakeYtm(SONGS) })
    const sent: string[] = []
    core.player.connect((c) =>
      sent.push(c.type === 'load' ? `load ${c.nowPlaying.recording.title}` : c.type),
    )
    const cloud = await core.catalog.resolve('ytm:aaaaaaaaaaa')
    const local = core.library.create({ title: 'Local', artists: [], inLibrary: true })
    core.library.addSource(local.id, { kind: 'local', locator: '/m/local.mp3' })
    core.queue.add({ recordingId: cloud.id, origin: 'user' })
    core.queue.add({ recordingId: local.id, origin: 'user' })

    core.player.patch({ playing: true })
    expect(sent.filter((s) => s.startsWith('load'))).toEqual(['load Local'])
    expect(core.health.get().status).toBe('green')
  })
})
