import { CLASSIC_OVERLAY, createCore, type Core, type Overlay } from '@halocline/core'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { offlineYtm } from './fake-ytm'
import { createApi } from '../src'

let core: Core
let app: ReturnType<typeof createApi>
let artworkDir: string

beforeEach(() => {
  artworkDir = mkdtempSync(join(tmpdir(), 'halocline-art-'))
  core = createCore({ dbPath: ':memory:', ytm: offlineYtm, scanner: { artworkDir } })
  app = createApi(core)
})
afterEach(async () => {
  await core.close()
  rmSync(artworkDir, { recursive: true, force: true })
})

const admin = () => core.tokens.create('admin', ['admin']).secret
const get = (path: string, token?: string) =>
  app.request(`http://127.0.0.1:17380${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
const send = (method: string, path: string, token: string, body?: unknown, ifMatch?: string) =>
  app.request(`http://127.0.0.1:17380${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(ifMatch && { 'If-Match': ifMatch }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
const wide = { ...CLASSIC_OVERLAY, canvas: { width: 600, height: 140 } }

describe('overlay', () => {
  it('serves the page with a CSP that allows only its own script', async () => {
    const res = await get('/overlay/now-playing?token=whatever')
    expect(res.status).toBe(200)
    const html = await res.text()
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
    const hash = createHash('sha256').update(script).digest('base64')
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain(`script-src 'sha256-${hash}'`)
    expect(csp).toContain("default-src 'none'")
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(html.match(/<script>/g)).toHaveLength(1)
    expect(script).toContain('hl-overlay')
  })

  it('serves the page for each overlay, and a 404 for unknown ones', async () => {
    const extra = core.overlays.create({ name: 'Extra' })
    expect((await get(`/overlay/${extra.id}?token=x`)).status).toBe(200)
    expect((await get('/overlay/no-such-overlay?token=x')).status).toBe(404)
    expect((await get('/overlay/Not%20An%20Id?token=x')).status).toBe(404)
  })

  it('creates one overlay token, reuses it, and rotates it', async () => {
    expect((await get('/v1/overlay', core.tokens.create('r', ['read']).secret)).status).toBe(403)
    const token = admin()
    const first = (await (await get('/v1/overlay', token)).json()) as { url: string }
    expect(first).toMatchObject({ width: 375, height: 140 })
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:17380\/overlay\/now-playing\?token=hl_/)
    const again = (await (await get('/v1/overlay', token)).json()) as { url: string }
    expect(again.url).toBe(first.url)

    const secret = new URL(first.url).searchParams.get('token')!
    expect((await get(`/v1/player?token=${secret}`)).status).toBe(200)
    expect((await get(`/v1/queue?token=${secret}`)).status).toBe(403)

    const rotated = (await (
      await app.request('http://127.0.0.1:17380/v1/overlay/rotate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { url: string }
    expect(rotated.url).not.toBe(first.url)
    expect((await get(`/v1/player?token=${secret}`)).status).toBe(401)
    expect(core.tokens.list().filter((t) => t.scopes.includes('overlay'))).toHaveLength(1)
  })

  it('serves extracted artwork to overlay tokens, and nothing else', async () => {
    const name = `${'a'.repeat(40)}.jpg`
    writeFileSync(join(artworkDir, name), 'jpeg bytes')
    writeFileSync(join(artworkDir, 'secret.txt'), 'nope')
    const secret = core.tokens.overlaySecret()

    const res = await get(`/v1/artwork/${name}?token=${secret}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(await res.text()).toBe('jpeg bytes')
    expect((await get(`/v1/artwork/secret.txt?token=${secret}`)).status).toBe(404)
    expect((await get(`/v1/artwork/..%2Fsecret.txt?token=${secret}`)).status).toBe(404)
    expect((await get(`/v1/artwork/${'b'.repeat(40)}.png?token=${secret}`)).status).toBe(404)
    expect((await get(`/v1/artwork/${name}`)).status).toBe(401)
  })

  it('creates, edits and deletes overlays, with revisions as ETags', async () => {
    const token = admin()
    const created = await send('POST', '/v1/overlays', token, { name: 'Wide', document: wide })
    expect(created.status).toBe(201)
    const overlay = (await created.json()) as Overlay
    expect(created.headers.get('ETag')).toBe('"1"')
    expect(overlay).toMatchObject({ name: 'Wide', revision: 1, document: wide })

    const list = (await (await get('/v1/overlays', token)).json()) as Overlay[]
    expect(list.map((o) => o.name)).toEqual(['Now playing', 'Wide'])

    const renamed = await send('PATCH', `/v1/overlays/${overlay.id}`, token, { name: 'W' }, '"1"')
    expect(renamed.status).toBe(200)
    expect(renamed.headers.get('ETag')).toBe('"2"')
    const stale = await send('PATCH', `/v1/overlays/${overlay.id}`, token, { name: 'X' }, '"1"')
    expect(stale.status).toBe(412)
    const bad = await send('PATCH', `/v1/overlays/${overlay.id}`, token, {
      document: { ...wide, elements: [{ type: 'rect', id: 'Bad Id' }] },
    })
    expect(bad.status).toBe(400)

    const info = (await (await get(`/v1/overlays/${overlay.id}/url`, token)).json()) as {
      url: string
    }
    expect(info).toMatchObject({ width: 600, height: 140 })
    expect(info.url).toContain(`/overlay/${overlay.id}?token=hl_`)

    expect((await send('DELETE', `/v1/overlays/${overlay.id}`, token)).status).toBe(204)
    expect((await get(`/v1/overlays/${overlay.id}`, token)).status).toBe(404)
    expect((await send('DELETE', '/v1/overlays/now-playing', token)).status).toBe(400)
  })

  it('lets the overlay token read documents, but change nothing', async () => {
    const secret = core.tokens.overlaySecret()
    const res = await get(`/v1/overlays/now-playing?token=${secret}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Overlay).document).toEqual(CLASSIC_OVERLAY)
    expect((await get(`/v1/overlays?token=${secret}`)).status).toBe(403)
    const patch = await app.request(
      `http://127.0.0.1:17380/v1/overlays/now-playing?token=${secret}`,
      { method: 'PATCH', body: JSON.stringify({ name: 'Mine' }) },
    )
    expect(patch.status).toBe(403)
  })

  it('reports the default overlay at its own canvas size', async () => {
    core.overlays.update('now-playing', { document: wide })
    expect(await (await get('/v1/overlay', admin())).json()).toMatchObject({ width: 600 })
  })

  it('streams overlay changes to the overlay token, so OBS redraws', async () => {
    const secret = core.tokens.overlaySecret()
    const controller = new AbortController()
    const res = await app.request(`/v1/events?token=${secret}`, { signal: controller.signal })
    const reader = res.body!.getReader()
    // Not for overlay tokens: filtered out.
    core.events.publish({ type: 'queue.changed', data: { revision: 99 } })
    core.overlays.update('now-playing', { name: 'Main' })
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('event: overlay.changed')
    expect(text).not.toContain('queue.changed')
    controller.abort()
    await reader.cancel()
  })
})
