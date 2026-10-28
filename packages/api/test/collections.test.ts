import { createCore, type Core, type YtmCollectionDetail } from '@halocline/core'
import { afterEach, describe, expect, it } from 'vitest'
import { offlineYtm } from './fake-ytm'
import { createApi } from '../src'

let core: Core
afterEach(() => core.close())

const song = (videoId: string, title: string) => ({
  videoId,
  title,
  artists: ['Daft Punk'],
  album: 'Discovery',
  durationMs: 200_000,
  artwork: null,
})
const ALBUM: YtmCollectionDetail = {
  ref: 'ytm-album:MPREb_discovery',
  kind: 'album',
  title: 'Discovery',
  by: 'Daft Punk',
  year: '2001',
  artwork: null,
  songs: [song('aaaaaaaaaaa', 'One More Time'), song('bbbbbbbbbbb', 'Aerodynamic')],
}

function setup() {
  core = createCore({
    dbPath: ':memory:',
    ytm: { ...offlineYtm, getCollection: async (ref) => (ref === ALBUM.ref ? ALBUM : undefined) },
    autoplay: false,
  })
  const app = createApi(core)
  const token = core.tokens.create('t', ['read', 'queue:add']).secret
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  return { call }
}

describe('albums and playlists', () => {
  it('lists an album and queues all of it', async () => {
    const { call } = setup()
    const detail = await call('GET', `/v1/collections/${encodeURIComponent(ALBUM.ref)}`)
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({ title: 'Discovery', songs: [{}, {}] })

    const added = await call('POST', '/v1/queue/collections', { ref: ALBUM.ref })
    expect(added.status).toBe(201)
    const body = (await added.json()) as { items: { recording: { title: string } }[] }
    expect(body).toMatchObject({ collection: { ref: ALBUM.ref }, skipped: 0 })
    expect(body.items.map((i) => i.recording.title)).toEqual(['One More Time', 'Aerodynamic'])
    expect(core.queue.list().items).toHaveLength(2)
  })

  it('rejects refs that are wrong or unknown', async () => {
    const { call } = setup()
    expect((await call('POST', '/v1/queue/collections', { ref: 'ytm:aaaaaaaaaaa' })).status).toBe(
      400,
    )
    expect((await call('GET', '/v1/collections/ytm-album%3AMPREb_none')).status).toBe(404)
  })
})
