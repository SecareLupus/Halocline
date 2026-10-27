import { createCore, type Core, type Scope } from '@halocline/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApi } from '../src'

let core: Core
let app: ReturnType<typeof createApi>
let clock: number

beforeEach(() => {
  core = createCore({ dbPath: ':memory:' })
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
