import {
  BulkRecordingPatch,
  BulkResult,
  Id,
  LibraryPage,
  LibrarySort,
  Recording,
  RecordingDetail,
  RecordingPatch,
  ScanStatus,
  Tag,
  type Core,
} from '@halocline/core'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import { requireScope, type ApiEnv } from '../auth'
import { authErrors, errorResponse } from '../problem'

/** `true`/`false` (also 1/0, yes/no) in a query string, documented as a boolean. */
const queryBool = () => z.stringbool().openapi({ type: 'boolean' })

/** Query-string form of LibraryQuery: booleans and numbers arrive as text. */
const BrowseQuery = z.object({
  q: z.string().max(200).optional(),
  inLibrary: queryBool().default(true).openapi({ type: 'boolean', default: true }),
  streamSafe: queryBool().optional(),
  available: queryBool().optional(),
  tag: Tag.optional(),
  sort: LibrarySort.default('title'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(1000).optional(),
})

const RecordingParams = z.object({ id: Id })

const SaveRequest = z.object({
  /** A recording ID, a `ytm:<videoId>` ref, or a music.youtube.com link. */
  input: z.string().min(1).max(2000),
})

const ScanRequest = z.object({
  /** Re-read tags of every file, not just new or changed ones. */
  full: z.boolean().default(false),
})

export function registerLibrary(app: OpenAPIHono<ApiEnv>, core: Core) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/library/recordings',
      tags: ['library'],
      summary: 'Browse the library',
      description:
        'Cursor-paginated. Pass `nextCursor` back as `cursor`, with the same `sort`, to get the next page.',
      middleware: [requireScope('read')],
      request: { query: BrowseQuery },
      responses: {
        200: {
          description: 'A page of recordings',
          content: { 'application/json': { schema: LibraryPage } },
        },
        ...authErrors,
        400: errorResponse('Bad filter or cursor'),
      },
    }),
    (c) => c.json(core.library.browse(c.req.valid('query')), 200),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/library/recordings/{id}',
      tags: ['library'],
      summary: 'One recording, with all its sources',
      middleware: [requireScope('read')],
      request: { params: RecordingParams },
      responses: {
        200: {
          description: 'The recording',
          content: { 'application/json': { schema: RecordingDetail } },
        },
        ...authErrors,
        404: errorResponse('No such recording'),
      },
    }),
    (c) => c.json(core.library.detail(c.req.valid('param').id), 200),
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/library/recordings/{id}',
      tags: ['library'],
      summary: 'Add to or remove from the library; set stream-safe and tags',
      middleware: [requireScope('library:write')],
      request: {
        params: RecordingParams,
        body: { content: { 'application/json': { schema: RecordingPatch } }, required: true },
      },
      responses: {
        200: {
          description: 'The updated recording',
          content: { 'application/json': { schema: Recording } },
        },
        ...authErrors,
        404: errorResponse('No such recording'),
      },
    }),
    (c) => c.json(core.library.edit(c.req.valid('param').id, c.req.valid('json')), 200),
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/library/recordings',
      tags: ['library'],
      summary: 'Apply one change to many recordings',
      description:
        'All-or-nothing for the IDs that exist; unknown IDs are listed in `notFound`. ' +
        'Use `addTags`/`removeTags` rather than `tags` to avoid overwriting existing tags.',
      middleware: [requireScope('library:write')],
      request: {
        body: { content: { 'application/json': { schema: BulkRecordingPatch } }, required: true },
      },
      responses: {
        200: {
          description: 'What changed',
          content: { 'application/json': { schema: BulkResult } },
        },
        ...authErrors,
      },
    }),
    (c) => {
      const { ids, changes } = c.req.valid('json')
      return c.json(core.library.editMany(ids, changes), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/library/recordings',
      tags: ['library'],
      summary: 'Save a song to the library',
      description:
        'Takes what `POST /v1/queue/items` takes: a recording ID, a `ytm:<videoId>` ref or a ' +
        'music.youtube.com link. A cloud song that matches a local file joins that recording ' +
        'instead of duplicating it. Saving twice is harmless.',
      middleware: [requireScope('library:write')],
      request: {
        body: { content: { 'application/json': { schema: SaveRequest } }, required: true },
      },
      responses: {
        200: {
          description: 'The saved recording',
          content: { 'application/json': { schema: RecordingDetail } },
        },
        ...authErrors,
        404: errorResponse('Nothing matched'),
        422: errorResponse('More than one recording matched'),
        501: errorResponse('That kind of link is not supported yet'),
        503: errorResponse('YouTube Music is unavailable'),
      },
    }),
    async (c) => {
      const recording = await core.catalog.save(c.req.valid('json').input)
      return c.json(core.library.detail(recording.id), 200)
    },
  )

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
