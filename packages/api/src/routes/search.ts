import { Recording, Source, type Core } from '@halocline/core'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import { requireScope, type ApiEnv } from '../auth'
import { authErrors } from '../problem'

const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  scope: z.enum(['library', 'ytm', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const SearchResult = z.object({ recording: Recording, sources: z.array(Source) })
const SearchResults = z.object({ results: z.array(SearchResult) })

export function registerSearch(app: OpenAPIHono<ApiEnv>, core: Core) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/search',
      tags: ['search'],
      summary: 'Search the library (and, once Phase 2 lands, YouTube Music songs)',
      middleware: [requireScope('read')],
      request: { query: SearchQuery },
      responses: {
        200: {
          description: 'Results, library first',
          content: { 'application/json': { schema: SearchResults } },
        },
        ...authErrors,
      },
    }),
    (c) => {
      const { q, scope, limit } = c.req.valid('query')
      // YTM search is Phase 2; until then every scope searches the library only.
      const recordings = scope === 'ytm' ? [] : core.library.search(q, limit)
      const results = recordings.map((recording) => ({
        recording,
        sources: core.library.sources(recording.id),
      }))
      return c.json({ results }, 200)
    },
  )
}
