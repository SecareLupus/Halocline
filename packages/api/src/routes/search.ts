import { Resolution, SearchResult, type Core } from '@halocline/core'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import { requireScope, type ApiEnv } from '../auth'
import { authErrors, errorResponse } from '../problem'

const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  scope: z.enum(['library', 'ytm', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const SearchResults = z.object({ results: z.array(SearchResult) })

const ResolveRequest = z.object({
  /** A track link, a `ytm:<videoId>` ref, a recording ID or a library search. */
  input: z.string().min(1).max(2000),
})

export function registerSearch(app: OpenAPIHono<ApiEnv>, core: Core) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/search',
      tags: ['search'],
      summary: 'Search the library, YouTube Music songs, and YouTube Music albums and playlists',
      description:
        'Library results come first, then YTM songs, then up to four YTM albums and four playlists ' +
        "(`ytm-collection`). A song's `ref` goes to `POST /v1/queue/items` as `input`; an album's " +
        "or playlist's `ref` to `GET /v1/collections/{ref}` (its tracks) or " +
        '`POST /v1/queue/collections` (all of it).',
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

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/resolve',
      tags: ['search'],
      summary: 'Work out what a link or query means, without enqueueing',
      description:
        'Reads track links from YouTube, YouTube Music, Spotify, Tidal, Apple Music and Deezer ' +
        '(PLAN §5) and matches them against the library, then YouTube Music. `match` is set when ' +
        'one answer is confident enough to play without asking; `candidates` lists the options, ' +
        "best first. Pass a candidate's `input` to `POST /v1/queue/items` to enqueue it.",
      middleware: [requireScope('read', 'queue:add')],
      request: {
        body: { content: { 'application/json': { schema: ResolveRequest } }, required: true },
      },
      responses: {
        200: {
          description: 'The resolution',
          content: { 'application/json': { schema: Resolution } },
        },
        ...authErrors,
        404: errorResponse('The link points at nothing'),
        501: errorResponse('Links from that site are not supported'),
        503: errorResponse('A metadata service or YouTube Music is unreachable'),
      },
    }),
    async (c) => c.json(await core.catalog.preview(c.req.valid('json').input), 200),
  )
}
