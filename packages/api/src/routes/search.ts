import { SearchResult, type Core } from '@halocline/core'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import { requireScope, type ApiEnv } from '../auth'
import { authErrors, errorResponse } from '../problem'

const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  scope: z.enum(['library', 'ytm', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const SearchResults = z.object({ results: z.array(SearchResult) })

export function registerSearch(app: OpenAPIHono<ApiEnv>, core: Core) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/search',
      tags: ['search'],
      summary: 'Search the library and YouTube Music songs',
      description:
        'Library results come first. YTM results carry a `ref` to pass as `input` to `POST /v1/queue/items`.',
      middleware: [requireScope('read')],
      request: { query: SearchQuery },
      responses: {
        200: {
          description: 'Results, library first',
          content: { 'application/json': { schema: SearchResults } },
        },
        ...authErrors,
        503: errorResponse('YouTube Music is unreachable and there were no library results'),
      },
    }),
    async (c) => {
      const { q, scope, limit } = c.req.valid('query')
      return c.json({ results: await core.catalog.search(q, scope, limit) }, 200)
    },
  )
}
