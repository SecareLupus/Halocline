import { createCore, type Core, type Scope } from '@halocline/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { offlineYtm } from './fake-ytm'
import { createApi } from '../src'

let core: Core
let app: ReturnType<typeof createApi>
let clock: number

beforeEach(() => {
  core = createCore({ dbPath: ':memory:', ytm: offlineYtm })
  clock = 1_000_000
  app = createApi(core, { now: () => clock })
})
afterEach(() => core.close())

const tokenFor = (scopes: Scope[], rateLimitPerMin?: number) =>
  core.tokens.create('test', scopes, rateLimitPerMin).secret

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = res.status === 204 ? null : await res.json()
  return { res, json }
}

const song = (title: string) => core.library.create({ title, artists: ['Artist'], inLibrary: true })

describe('library routes', () => {
  it('browses with cursor pagination and query-string filters', async () => {
    const token = tokenFor(['read'])
    for (const t of ['A', 'B', 'C', 'D', 'E']) song(t)
    core.library.edit(core.library.search('c')[0]!.id, { streamSafe: true })

    const first = await call('GET', '/v1/library/recordings?limit=2', token)
    expect(first.json.items.map((r: { title: string }) => r.title)).toEqual(['A', 'B'])
    const second = await call(
      'GET',
      `/v1/library/recordings?limit=2&cursor=${first.json.nextCursor}`,
      token,
    )
    expect(second.json.items.map((r: { title: string }) => r.title)).toEqual(['C', 'D'])

    const safe = await call('GET', '/v1/library/recordings?streamSafe=true', token)
    expect(safe.json).toMatchObject({ items: [{ title: 'C', available: false }], nextCursor: null })

    const bad = await call(
      'GET',
      '/v1/library/recordings?sort=added&cursor=' + first.json.nextCursor,
      token,
    )
    expect(bad.res.status).toBe(400)
    expect(bad.json.type).toBe('invalid_request')
  })

  it('reads one recording with its sources', async () => {
    const r = song('Solo')
    core.library.addSource(r.id, { kind: 'local', locator: '/m/solo.mp3' })
    const { json } = await call('GET', `/v1/library/recordings/${r.id}`, tokenFor(['read']))
    expect(json).toMatchObject({
      title: 'Solo',
      sources: [{ kind: 'local', locator: '/m/solo.mp3' }],
    })
    expect((await call('GET', '/v1/library/recordings/nope', tokenFor(['read']))).res.status).toBe(
      404,
    )
  })

  it('edits one recording and bulk-tags many, needing library:write', async () => {
    const [a, b] = [song('A'), song('B')]
    const writer = tokenFor(['library:write'])
    const one = await call('PATCH', `/v1/library/recordings/${a.id}`, writer, {
      streamSafe: true,
      tags: ['chill'],
    })
    expect(one.json).toMatchObject({ streamSafe: true, tags: ['chill'] })

    const bulk = await call('PATCH', '/v1/library/recordings', writer, {
      ids: [a.id, b.id, 'ghost'],
      changes: { streamSafe: true, addTags: ['stream'] },
    })
    expect(bulk.json).toEqual({ updated: 2, notFound: ['ghost'] })
    expect(core.library.get(a.id)?.tags).toEqual(['chill', 'stream'])

    const conflicting = await call('PATCH', `/v1/library/recordings/${a.id}`, writer, {
      tags: [],
      addTags: ['x'],
    })
    expect(conflicting.res.status).toBe(400)
    expect(
      (
        await call('PATCH', `/v1/library/recordings/${a.id}`, tokenFor(['read']), {
          streamSafe: false,
        })
      ).res.status,
    ).toBe(403)
  })
})

describe('merge and split routes', () => {
  it('merges duplicates and splits them apart again, needing library:write', async () => {
    const token = tokenFor(['library:write'])
    const keep = song('Halo')
    const dupe = song('Halo (copy)')
    core.library.addSource(keep.id, { kind: 'local', locator: '/music/halo.flac' })
    const ytm = core.library.addSource(dupe.id, { kind: 'ytm', locator: 'XXXXXXXXXXX' })

    expect(
      (
        await call('POST', `/v1/library/recordings/${keep.id}/merge`, tokenFor(['read']), {
          from: [dupe.id],
        })
      ).res.status,
    ).toBe(403)
    const merged = await call('POST', `/v1/library/recordings/${keep.id}/merge`, token, {
      from: [dupe.id],
    })
    expect(merged.res.status).toBe(200)
    expect(merged.json).toMatchObject({ id: keep.id, title: 'Halo' })
    expect(merged.json.sources).toHaveLength(2)
    expect(
      (
        await call('POST', `/v1/library/recordings/${keep.id}/merge`, token, {
          from: [keep.id],
        })
      ).res.status,
    ).toBe(400)

    const split = await call('POST', `/v1/library/recordings/${keep.id}/split`, token, {
      sourceIds: [ytm.id],
    })
    expect(split.res.status).toBe(201)
    expect(split.json.original.sources).toHaveLength(1)
    expect(split.json.split).toMatchObject({ streamSafe: false, sources: [{ id: ytm.id }] })
    expect(
      (
        await call('POST', `/v1/library/recordings/${keep.id}/split`, token, {
          sourceIds: [split.json.original.sources[0].id],
        })
      ).res.status,
    ).toBe(400)
  })
})

describe('history', () => {
  it('lists plays latest first and lets admin clear them', async () => {
    const a = song('First')
    const b = song('Second')
    core.library.markPlayed(a.id, new Date(Date.UTC(2026, 9, 28, 12, 0)))
    core.library.markPlayed(b.id, new Date(Date.UTC(2026, 9, 28, 12, 5)))
    const page = await call('GET', '/v1/history?limit=1', tokenFor(['read']))
    expect(page.json).toMatchObject({ items: [{ recording: { title: 'Second' } }] })
    const older = await call(
      'GET',
      `/v1/history?before=${page.json.nextCursor}`,
      tokenFor(['read']),
    )
    expect(older.json).toMatchObject({
      items: [{ recording: { title: 'First' } }],
      nextCursor: null,
    })

    expect((await call('DELETE', '/v1/history', tokenFor(['read']))).res.status).toBe(403)
    expect((await call('DELETE', '/v1/history', tokenFor(['admin']))).res.status).toBe(204)
    expect((await call('GET', '/v1/history', tokenFor(['read']))).json.items).toEqual([])
  })
})

describe('rate limits', () => {
  it('allows a burst up to the limit, then 429s with Retry-After', async () => {
    const token = tokenFor(['read'], 3)
    for (let i = 0; i < 3; i++) {
      const { res } = await call('GET', '/v1/queue', token)
      expect(res.status).toBe(200)
      expect(res.headers.get('RateLimit-Remaining')).toBe(String(2 - i))
    }
    const limited = await call('GET', '/v1/queue', token)
    expect(limited.res.status).toBe(429)
    expect(limited.json.type).toBe('rate_limited')
    expect(limited.res.headers.get('Retry-After')).toBe('20') // 3/min refills one every 20 s
    expect(limited.res.headers.get('RateLimit-Limit')).toBe('3')
  })

  it('refills over time and limits each token separately', async () => {
    const limited = tokenFor(['read'], 1)
    const unlimited = tokenFor(['read'])
    expect((await call('GET', '/v1/queue', limited)).res.status).toBe(200)
    expect((await call('GET', '/v1/queue', limited)).res.status).toBe(429)
    for (let i = 0; i < 5; i++) {
      const { res } = await call('GET', '/v1/queue', unlimited)
      expect(res.status).toBe(200)
      expect(res.headers.get('RateLimit-Limit')).toBeNull()
    }
    clock += 60_000
    expect((await call('GET', '/v1/queue', limited)).res.status).toBe(200)
  })
})

describe('POST /v1/library/recordings', () => {
  it('saves a recording to the library, once', async () => {
    const token = core.tokens.create('w', ['library:write']).secret
    const queued = core.library.create({ title: 'Cloud song', artists: ['A'], inLibrary: false })
    const save = () =>
      app.request('/v1/library/recordings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: queued.id }),
      })
    const res = await save()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: queued.id, inLibrary: true, sources: [] })
    expect((await save()).status).toBe(200)

    const readOnly = core.tokens.create('r', ['read']).secret
    const denied = await app.request('/v1/library/recordings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${readOnly}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'ytm:aaaaaaaaaaa' }),
    })
    expect(denied.status).toBe(403)
  })
})
