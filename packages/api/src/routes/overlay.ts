import {
  DEFAULT_OVERLAY_ID,
  NewOverlay,
  Overlay,
  OverlayId,
  OverlayUpdate,
  type Core,
} from '@halocline/core'
import renderer from '@halocline/overlay/page?bundle'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { requireScope, type ApiEnv } from '../auth'
import { authErrors, errorResponse, problem } from '../problem'
import { expectedRevision } from '../revision'

/** An overlay's address, and the size to give its Browser Source: its canvas (PLAN §8). */
const OverlayInfo = z
  .object({
    url: z.url(),
    width: z.number().int(),
    height: z.number().int(),
  })
  .openapi('OverlayInfo')

const OverlayParams = z.object({ id: OverlayId })

const ifMatchHeader = z.object({
  'if-match': z.string().optional().describe('Overlay revision from its last read (its ETag)'),
})

const ARTWORK_NAME = /^[0-9a-f]{40}\.(jpg|jpeg|png|webp|gif|bmp)$/
const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

// It's inlined into the page, where a `</script` would end it early.
if (/<\/script/i.test(renderer)) throw new Error('The overlay renderer contains "</script"')

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

/**
 * The renderer is the page's only script, allowed by hash, so nothing else can
 * run. Styles stay open because OBS injects the Browser Source's "Custom CSS" as
 * a <style> element. Cloud artwork comes from Google's image hosts; local art
 * from this API.
 */
const OVERLAY_CSP = [
  "default-src 'none'",
  `script-src ${sha256(renderer)}`,
  "style-src 'unsafe-inline'",
  "img-src 'self' https://*.googleusercontent.com https://*.ytimg.com https://*.ggpht.com",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * The Browser Source page, the same for every overlay: the renderer reads the
 * overlay's id from the address, and its document and the player from the API.
 */
const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>Halocline now playing</title>
    <style>
      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <script>${renderer}</script>
  </body>
</html>`

export function overlayUrl(origin: string, secret: string, id = DEFAULT_OVERLAY_ID): string {
  return `${origin}/overlay/${encodeURIComponent(id)}?token=${encodeURIComponent(secret)}`
}

const withETag = (c: Context, overlay: Overlay) => {
  c.header('ETag', `"${overlay.revision}"`)
  return overlay
}

export function registerOverlay(app: OpenAPIHono<ApiEnv>, core: Core) {
  // The page itself holds no data; it reads everything with the token in its URL.
  app.get('/overlay/:id', (c) => {
    const id = OverlayId.safeParse(c.req.param('id'))
    if (!id.success) return problem(c, 'not_found', 'No such overlay')
    core.overlays.get(id.data) // A 404 if there's no such overlay.
    return c.html(page, 200, {
      'Content-Security-Policy': OVERLAY_CSP,
      // The token is in the URL; don't hand it to image hosts.
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    })
  })

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

  const overlayInfo = (c: Context, secret: string, id = DEFAULT_OVERLAY_ID) => ({
    url: overlayUrl(new URL(c.req.url).origin, secret, id),
    ...core.overlays.get(id).document.canvas,
  })

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/overlays',
      tags: ['overlay'],
      summary: 'Every overlay, the default one first',
      middleware: [requireScope('admin')],
      responses: {
        200: {
          description: 'Overlays',
          content: { 'application/json': { schema: z.array(Overlay) } },
        },
        ...authErrors,
      },
    }),
    (c) => c.json(core.overlays.list(), 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/overlays',
      tags: ['overlay'],
      summary: 'Create an overlay, from Classic unless a document is given',
      middleware: [requireScope('admin')],
      request: {
        body: { content: { 'application/json': { schema: NewOverlay } }, required: true },
      },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: Overlay } } },
        ...authErrors,
      },
    }),
    (c) => c.json(withETag(c, core.overlays.create(c.req.valid('json'))), 201),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/overlays/{id}',
      tags: ['overlay'],
      summary: 'One overlay and its document',
      description: 'Overlay tokens can read it too: the overlay page loads its document here.',
      middleware: [requireScope('read', 'overlay')],
      request: { params: OverlayParams },
      responses: {
        200: { description: 'The overlay', content: { 'application/json': { schema: Overlay } } },
        ...authErrors,
        404: errorResponse('No such overlay'),
      },
    }),
    (c) => c.json(withETag(c, core.overlays.get(c.req.valid('param').id)), 200),
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/overlays/{id}',
      tags: ['overlay'],
      summary: 'Rename an overlay or replace its document',
      description:
        'The document is replaced whole. Pages showing the overlay redraw at once. Send the ' +
        'revision you edited as If-Match, and a change made since fails with 412 instead of ' +
        'being overwritten.',
      middleware: [requireScope('admin')],
      request: {
        params: OverlayParams,
        headers: ifMatchHeader,
        body: { content: { 'application/json': { schema: OverlayUpdate } }, required: true },
      },
      responses: {
        200: { description: 'Updated', content: { 'application/json': { schema: Overlay } } },
        ...authErrors,
        404: errorResponse('No such overlay'),
        412: errorResponse('revision_mismatch'),
      },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const updated = core.overlays.update(id, c.req.valid('json'), expectedRevision(c))
      return c.json(withETag(c, updated), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/overlays/{id}',
      tags: ['overlay'],
      summary: "Delete an overlay; the default one can't be",
      middleware: [requireScope('admin')],
      request: { params: OverlayParams },
      responses: {
        204: { description: 'Deleted' },
        ...authErrors,
        400: errorResponse('The default overlay'),
        404: errorResponse('No such overlay'),
      },
    }),
    (c) => {
      core.overlays.delete(c.req.valid('param').id)
      return c.body(null, 204)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/overlays/{id}/url',
      tags: ['overlay'],
      summary: "An overlay's URL, creating the overlay token on first use",
      middleware: [requireScope('admin')],
      request: { params: OverlayParams },
      responses: {
        200: { description: 'Overlay', content: { 'application/json': { schema: OverlayInfo } } },
        ...authErrors,
        404: errorResponse('No such overlay'),
      },
    }),
    (c) => c.json(overlayInfo(c, core.tokens.overlaySecret(), c.req.valid('param').id), 200),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/overlay',
      tags: ['overlay'],
      summary: "The default overlay's URL, creating the overlay token on first use",
      middleware: [requireScope('admin')],
      responses: {
        200: { description: 'Overlay', content: { 'application/json': { schema: OverlayInfo } } },
        ...authErrors,
      },
    }),
    (c) => c.json(overlayInfo(c, core.tokens.overlaySecret()), 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/overlay/rotate',
      tags: ['overlay'],
      summary: "Replace the overlay token; every overlay's old URL stops working",
      middleware: [requireScope('admin')],
      responses: {
        200: { description: 'Overlay', content: { 'application/json': { schema: OverlayInfo } } },
        ...authErrors,
      },
    }),
    (c) => c.json(overlayInfo(c, core.tokens.rotateOverlay()), 200),
  )
}
