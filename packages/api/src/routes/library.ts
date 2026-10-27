import { ScanStatus, type Core } from '@halocline/core'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import { requireScope, type ApiEnv } from '../auth'
import { authErrors } from '../problem'

const ScanRequest = z.object({
  /** Re-read tags of every file, not just new or changed ones. */
  full: z.boolean().default(false),
})

export function registerLibrary(app: OpenAPIHono<ApiEnv>, core: Core) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/library/scan',
      tags: ['library'],
      summary: 'Rescan the library folders',
      description:
        'Starts a scan and returns at once. Follow progress with `scan.changed` events or `GET /v1/health`.',
      middleware: [requireScope('library:write')],
      request: {
        body: { content: { 'application/json': { schema: ScanRequest } }, required: false },
      },
      responses: {
        202: {
          description: 'Scan started',
          content: { 'application/json': { schema: ScanStatus } },
        },
        ...authErrors,
      },
    }),
    async (c) => {
      const body = c.req.header('Content-Type')?.includes('json')
        ? c.req.valid('json')
        : { full: false }
      void core.scanner.scan({ full: body.full })
      // Let the queued scan mark itself as started before reporting status.
      await Promise.resolve()
      return c.json(core.scanner.status(), 202)
    },
  )
}
