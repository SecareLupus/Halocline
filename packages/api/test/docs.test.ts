import { createCore, type Core } from '@halocline/core'
import { afterEach, describe, expect, it } from 'vitest'
import { offlineYtm } from './fake-ytm'
import { createApi } from '../src'

let core: Core
afterEach(() => core.close())

describe('API docs', () => {
  it('serves Swagger UI from the app, without a token', async () => {
    core = createCore({ dbPath: ':memory:', ytm: offlineYtm, autoplay: false })
    const app = createApi(core)
    const page = await app.request('/docs')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'")
    const html = await page.text()
    expect(html).toContain('/docs/swagger-ui-bundle.js')
    expect(html).not.toMatch(/https?:\/\//)
    const script = await app.request('/docs/swagger-ui-bundle.js')
    expect(script.headers.get('content-type')).toContain('javascript')
    expect((await script.text()).length).toBeGreaterThan(100_000)
    expect(await (await app.request('/docs/init.js')).text()).toContain("url: '/openapi.json'")
    expect((await app.request('/')).headers.get('location')).toBe('/docs')
  })
})
