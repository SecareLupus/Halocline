import { createCore, type Core } from '@halocline/core'
import { afterEach, describe, expect, it } from 'vitest'
import { offlineYtm } from './fake-ytm'
import { createApi } from '../src'

let core: Core
afterEach(() => core.close())

const SPOTIFY_HTML = `<meta property="og:title" content="Halo Song"/>
<meta property="og:description" content="Halo Band · Album · Song · 2020"/>
<meta name="music:duration" content="200"/>`

function setup() {
  const fetch = (async (input: string | URL | Request) =>
    String(input).startsWith('https://open.spotify.com/')
      ? new Response(SPOTIFY_HTML)
      : Response.json({ data: [] })) as typeof globalThis.fetch
  core = createCore({ dbPath: ':memory:', ytm: offlineYtm, fetch })
  const app = createApi(core)
  const token = core.tokens.create('t', ['read', 'queue:add']).secret
  const post = (path: string, input: string) =>
    app.request(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    })
  return { post }
}

describe('POST /v1/resolve', () => {
  it('resolves a link against the library without enqueueing', async () => {
    const { post } = setup()
    const owned = core.library.create({
      title: 'Halo Song',
      artists: ['Halo Band'],
      durationMs: 201_000,
      inLibrary: true,
    })
    const res = await post('/v1/resolve', 'https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      link: { provider: 'spotify', title: 'Halo Song', durationMs: 200_000 },
      match: { input: owned.id, source: 'library' },
      cached: false,
    })
    expect(core.queue.list().items).toHaveLength(0)
  })

  it('hands back candidates with 422 when a query is ambiguous', async () => {
    const { post } = setup()
    core.library.create({ title: 'Halo One', artists: ['A'], inLibrary: true })
    core.library.create({ title: 'Halo Two', artists: ['B'], inLibrary: true })
    const res = await post('/v1/queue/items', 'halo')
    expect(res.status).toBe(422)
    const body = (await res.json()) as { type: string; candidates: { input: string }[] }
    expect(body.type).toBe('match_ambiguous')
    expect(body.candidates).toHaveLength(2)
    expect((await post('/v1/queue/items', body.candidates[0]!.input)).status).toBe(201)
  })
})
