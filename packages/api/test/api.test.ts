import { createCore, type Core, type Scope } from '@halocline/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApi } from '../src'

let core: Core
let app: ReturnType<typeof createApi>

beforeEach(() => {
  core = createCore({ dbPath: ':memory:' })
  app = createApi(core)
})
afterEach(() => core.close())

const tokenFor = (...scopes: Scope[]) => core.tokens.create('test', scopes).secret

function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return app.request(path, {
    method,
    headers: {
      ...(opts.token && { Authorization: `Bearer ${opts.token}` }),
      ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
      ...opts.headers,
    },
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
  })
}

// Response bodies are checked structurally, so loose typing is fine here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response | Promise<Response>): Promise<any> =>
  Promise.resolve(res).then((r) => r.json())

const song = (title: string, streamSafe = false) =>
  core.library.create({ title, artists: ['Artist'], inLibrary: true, streamSafe })

describe('auth', () => {
  it('rejects missing and unknown tokens with problem+json', async () => {
    const res = await call('GET', '/v1/queue')
    expect(res.status).toBe(401)
    expect(res.headers.get('Content-Type')).toBe('application/problem+json')
    expect(await json(res)).toMatchObject({ type: 'unauthorized', status: 401 })
    expect((await call('GET', '/v1/queue', { token: 'hl_nope' })).status).toBe(401)
  })

  it('enforces scopes, with admin implying all', async () => {
    const reader = tokenFor('read')
    expect((await call('GET', '/v1/queue', { token: reader })).status).toBe(200)
    const res = await call('DELETE', '/v1/queue/items', { token: reader })
    expect(res.status).toBe(403)
    expect((await call('DELETE', '/v1/queue/items', { token: tokenFor('admin') })).status).toBe(204)
  })

  it('accepts ?token= only for overlay tokens, and limits what they can read', async () => {
    const overlay = tokenFor('overlay')
    expect((await call('GET', `/v1/player?token=${overlay}`)).status).toBe(200)
    expect((await call('GET', `/v1/queue?token=${overlay}`)).status).toBe(403)
    expect((await call('GET', `/v1/player?token=${tokenFor('read')}`)).status).toBe(401)
  })
})

describe('queue', () => {
  it('enqueues by recording id or unique query, with ETag revisions', async () => {
    const token = tokenFor('queue:manage', 'read')
    const a = song('Alpha')
    song('Bravo')
    const res = await call('POST', '/v1/queue/items', { token, body: { input: a.id } })
    expect(res.status).toBe(201)
    expect(res.headers.get('ETag')).toBe('"1"')
    expect(await json(res)).toMatchObject({ origin: 'api', recording: { title: 'Alpha' } })

    await call('POST', '/v1/queue/items', { token, body: { input: 'brav', position: 'next' } })
    const queue = await json(call('GET', '/v1/queue', { token }))
    expect(queue.items.map((i: { recording: { title: string } }) => i.recording.title)).toEqual([
      'Bravo',
      'Alpha',
    ])
  })

  it('returns candidates when a query is ambiguous', async () => {
    song('Same Name')
    song('Same Name')
    const res = await call('POST', '/v1/queue/items', {
      token: tokenFor('queue:add'),
      body: { input: 'same' },
    })
    expect(res.status).toBe(422)
    expect((await json(res)).candidates).toHaveLength(2)
  })

  it('rejects stale If-Match with 412', async () => {
    const token = tokenFor('queue:manage')
    const a = song('Alpha')
    await call('POST', '/v1/queue/items', { token, body: { input: a.id } })
    const res = await call('POST', '/v1/queue/items', {
      token,
      body: { input: a.id },
      headers: { 'If-Match': '"0"' },
    })
    expect(res.status).toBe(412)
    expect(await json(res)).toMatchObject({ type: 'revision_mismatch', current: 1 })
  })

  it('rejects untagged songs in stream-safe mode with 409', async () => {
    core.settings.patch({ streamSafeMode: true })
    const res = await call('POST', '/v1/queue/items', {
      token: tokenFor('queue:add'),
      body: { input: song('Risky').id },
    })
    expect(res.status).toBe(409)
    expect((await json(res)).type).toBe('stream_safe_violation')
  })

  it('moves and deletes items by id', async () => {
    const token = tokenFor('queue:manage', 'read')
    const ids: string[] = []
    for (const t of ['A', 'B', 'C']) {
      ids.push(
        (await json(call('POST', '/v1/queue/items', { token, body: { input: song(t).id } }))).id,
      )
    }
    expect(
      (await call('PATCH', `/v1/queue/items/${ids[0]}`, { token, body: { position: 'end' } }))
        .status,
    ).toBe(200)
    expect((await call('DELETE', `/v1/queue/items/${ids[1]}`, { token })).status).toBe(204)
    const queue = await json(call('GET', '/v1/queue', { token }))
    expect(queue.items.map((i: { recording: { title: string } }) => i.recording.title)).toEqual([
      'C',
      'A',
    ])
    expect((await call('DELETE', `/v1/queue/items/${ids[1]}`, { token })).status).toBe(404)
  })

  it('validates bodies', async () => {
    const res = await call('POST', '/v1/queue/items', {
      token: tokenFor('queue:add'),
      body: { input: '' },
    })
    expect(res.status).toBe(400)
    expect((await json(res)).type).toBe('validation_failed')
  })
})

describe('events', () => {
  it('streams events and replays after Last-Event-ID', async () => {
    const token = tokenFor('read')
    core.queue.add({ recordingId: song('A').id, origin: 'user' }) // event ids 1 (library), 2 (queue)
    const controller = new AbortController()
    const res = await app.request('/v1/events', {
      headers: { Authorization: `Bearer ${token}`, 'Last-Event-ID': '1' },
      signal: controller.signal,
    })
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('event: queue.changed')
    expect(text).toContain('id: 2')
    controller.abort()
    await reader.cancel()
  })
})

describe('openapi', () => {
  it('serves a 3.1 document without auth', async () => {
    const res = await call('GET', '/openapi.json')
    expect(res.status).toBe(200)
    const doc = await json(res)
    expect(doc.openapi).toBe('3.1.0')
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/v1/player',
        '/v1/queue',
        '/v1/queue/items/{id}',
        '/v1/search',
        '/v1/health',
      ]),
    )
  })
})

describe('library', () => {
  it('starts a scan and reports progress in health', async () => {
    const res = await call('POST', '/v1/library/scan', {
      token: tokenFor('library:write'),
      body: { full: true },
    })
    expect(res.status).toBe(202)
    expect(await json(res)).toMatchObject({ state: 'scanning' })
    await core.scanner.scan()
    const health = await json(call('GET', '/v1/health', { token: tokenFor('read') }))
    expect(health.scan).toMatchObject({ state: 'idle' })
    expect((await call('POST', '/v1/library/scan', { token: tokenFor('read') })).status).toBe(403)
  })
})

describe('player output', () => {
  it('lists output devices reported by the player', async () => {
    const state = {
      devices: [{ deviceId: 'sink1', label: 'OBS sink' }],
      activeDeviceId: 'sink1',
      error: null,
    }
    core.player.report({ type: 'output', state })
    expect(await json(call('GET', '/v1/player/output', { token: tokenFor('read') }))).toEqual(state)
    const res = await call('PATCH', '/v1/settings', {
      token: tokenFor('admin'),
      body: { playback: { outputDeviceId: 'sink1', crossfadeMs: 3000 } },
    })
    expect(await json(res)).toMatchObject({
      playback: { outputDeviceId: 'sink1', crossfadeMs: 3000, gaplessAlbums: true },
    })
  })
})
