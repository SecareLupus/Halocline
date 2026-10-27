import type { Core } from '@halocline/core'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { requireScope, type ApiEnv } from '../auth'
import nowPlayingHtml from '../overlay/now-playing.html?raw'
import { authErrors, problem } from '../problem'

/** PLAN §8: the size the layout is designed for. */
export const OVERLAY_SIZE = { width: 800, height: 120 }

const OverlayInfo = z
  .object({
    url: z.url(),
    width: z.number().int(),
    height: z.number().int(),
  })
  .openapi('OverlayInfo')

const ARTWORK_NAME = /^[0-9a-f]{40}\.(jpg|jpeg|png|webp|gif|bmp)$/
const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
const scriptHashes = [...nowPlayingHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) =>
  sha256(m[1] ?? ''),
)

/**
 * The page's inline script is allowed by hash, so nothing else can run. Styles
 * stay open because OBS injects the Browser Source's "Custom CSS" as a <style>
 * element. Cloud artwork comes from Google's image hosts; local art from this API.
 */
const OVERLAY_CSP = [
  "default-src 'none'",
  `script-src ${scriptHashes.join(' ')}`,
  "style-src 'unsafe-inline'",
  "img-src 'self' https://*.googleusercontent.com https://*.ytimg.com https://*.ggpht.com",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function overlayUrl(origin: string, secret: string): string {
  return `${origin}/overlay/now-playing?token=${encodeURIComponent(secret)}`
}

export function registerOverlay(app: OpenAPIHono<ApiEnv>, core: Core) {
  // The page itself holds no data; it reads everything with the token in its URL.
  app.get('/overlay/now-playing', (c) =>
    c.html(nowPlayingHtml, 200, {
      'Content-Security-Policy': OVERLAY_CSP,
      // The token is in the URL; don't hand it to image hosts.
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    }),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/artwork/{name}',
      tags: ['overlay'],
      summary: 'Cover art the library scanner extracted',
      description: 'Names are content hashes, as in `Recording.artwork` for local tracks.',
      middleware: [requireScope('read', 'overlay')],
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: { description: 'The image', content: { 'image/*': { schema: z.any() } } },
        ...authErrors,
        404: { description: 'No such artwork' },
      },
    }),
    async (c) => {
      const { name } = c.req.valid('param')
      if (!ARTWORK_NAME.test(name)) return problem(c, 'not_found', 'No such artwork')
      try {
        const data = await readFile(join(core.artworkDir, name))
        return c.body(data, 200, {
          'Content-Type': IMAGE_TYPES[extname(name)] ?? 'application/octet-stream',
          // Content-addressed, so it never changes.
          'Cache-Control': 'private, max-age=31536000, immutable',
        })
      } catch {
        return problem(c, 'not_found', 'No such artwork')
      }
    },
  )

  const overlayInfo = (origin: string, secret: string) => ({
    url: overlayUrl(origin, secret),
    ...OVERLAY_SIZE,
  })

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/overlay',
      tags: ['overlay'],
      summary: 'The OBS overlay URL, creating its token on first use',
      middleware: [requireScope('admin')],
      responses: {
        200: { description: 'Overlay', content: { 'application/json': { schema: OverlayInfo } } },
        ...authErrors,
      },
    }),
    (c) => c.json(overlayInfo(new URL(c.req.url).origin, core.tokens.overlaySecret()), 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/overlay/rotate',
      tags: ['overlay'],
      summary: 'Replace the overlay token; the old URL stops working',
      middleware: [requireScope('admin')],
      responses: {
        200: { description: 'Overlay', content: { 'application/json': { schema: OverlayInfo } } },
        ...authErrors,
      },
    }),
    (c) => c.json(overlayInfo(new URL(c.req.url).origin, core.tokens.rotateOverlay()), 200),
  )
}
