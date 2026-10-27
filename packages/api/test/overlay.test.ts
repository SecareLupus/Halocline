import { createCore, type Core } from '@halocline/core'
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
    expect(html).toContain('class="hl-overlay')
  })

  it('creates one overlay token, reuses it, and rotates it', async () => {
    expect((await get('/v1/overlay', core.tokens.create('r', ['read']).secret)).status).toBe(403)
    const token = admin()
    const first = (await (await get('/v1/overlay', token)).json()) as { url: string }
    expect(first).toMatchObject({ width: 800, height: 120 })
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
})
