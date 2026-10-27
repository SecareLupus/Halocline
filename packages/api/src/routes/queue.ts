import { DomainError, Id, Queue, QueueItem, QueuePosition, type Core } from '@halocline/core'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { requireScope, type ApiEnv } from '../auth'
import { authErrors, errorResponse } from '../problem'

const ItemParams = z.object({ id: Id })

const AddItem = z.object({
  /** A recordingId, a `ytm:<videoId>` ref, a music.youtube.com link, or a library query. */
  input: z.string().min(1).max(2000),
  position: QueuePosition.default('end'),
  requestedBy: z.string().max(100).optional(),
})

const UpdateItem = z
  .object({ position: QueuePosition, pinnedSourceId: Id.nullable() })
  .partial()
  .strict()

const ifMatchHeader = z.object({
  'if-match': z.string().optional().describe('Queue revision from GET /v1/queue (its ETag)'),
})

/** Reads the queue revision from `If-Match`, accepting `"12"`, `W/"12"` or `12`. */
function expectedRevision(c: Context): number | undefined {
  const raw = c.req.header('If-Match')
  if (!raw || raw === '*') return undefined
  const n = Number(raw.replace(/^W\//, '').replaceAll('"', ''))
  if (!Number.isInteger(n) || n < 0) throw new DomainError('invalid_request', 'Bad If-Match header')
  return n
}

export function registerQueue(app: OpenAPIHono<ApiEnv>, core: Core) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/queue',
      tags: ['queue'],
      summary: 'Upcoming items and the queue revision',
      middleware: [requireScope('read')],
      responses: {
        200: { description: 'The queue', content: { 'application/json': { schema: Queue } } },
        ...authErrors,
      },
    }),
    (c) => {
      const queue = core.queue.list()
      c.header('ETag', `"${queue.revision}"`)
      return c.json(queue, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/queue/items',
      tags: ['queue'],
      summary: 'Resolve an input and enqueue it',
      middleware: [requireScope('queue:add', 'queue:manage')],
      request: {
        headers: ifMatchHeader,
        body: { content: { 'application/json': { schema: AddItem } }, required: true },
      },
      responses: {
        201: { description: 'Enqueued', content: { 'application/json': { schema: QueueItem } } },
        ...authErrors,
        404: errorResponse('Nothing matched'),
        409: errorResponse('stream_safe_violation'),
        412: errorResponse('revision_mismatch'),
        422: errorResponse('match_ambiguous, with candidates'),
      },
    }),
    async (c) => {
      const body = c.req.valid('json')
      const recording = await core.catalog.resolve(body.input)
      const revision = expectedRevision(c)
      const item = core.queue.add({
        recordingId: recording.id,
        position: body.position,
        origin: 'api',
        ...(body.requestedBy !== undefined && { requestedBy: body.requestedBy }),
        ...(revision !== undefined && { expectedRevision: revision }),
      })
      c.header('ETag', `"${core.queue.revision}"`)
      return c.json(item, 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/queue/items/{id}',
      tags: ['queue'],
      summary: 'Move an item or pin its source',
      middleware: [requireScope('queue:manage')],
      request: {
        params: ItemParams,
        headers: ifMatchHeader,
        body: { content: { 'application/json': { schema: UpdateItem } }, required: true },
      },
      responses: {
        200: {
          description: 'Updated item',
          content: { 'application/json': { schema: QueueItem } },
        },
        ...authErrors,
        404: errorResponse('No such item'),
        412: errorResponse('revision_mismatch'),
      },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      let revision = expectedRevision(c)
      let item = core.queue.get(id)
      if (body.position !== undefined) {
        item = core.queue.move(id, body.position, revision)
        revision = revision === undefined ? undefined : revision + 1
      }
      if (body.pinnedSourceId !== undefined)
        item = core.queue.pinSource(id, body.pinnedSourceId, revision)
      c.header('ETag', `"${core.queue.revision}"`)
      return c.json(item, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/queue/items/{id}',
      tags: ['queue'],
      summary: 'Remove an item',
      middleware: [requireScope('queue:manage')],
      request: { params: ItemParams, headers: ifMatchHeader },
      responses: {
        204: { description: 'Removed' },
        ...authErrors,
        404: errorResponse('No such item'),
        412: errorResponse('revision_mismatch'),
      },
    }),
    (c) => {
      core.queue.remove(c.req.valid('param').id, expectedRevision(c))
      c.header('ETag', `"${core.queue.revision}"`)
      return c.body(null, 204)
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/queue/items',
      tags: ['queue'],
      summary: 'Clear the queue',
      middleware: [requireScope('queue:manage')],
      request: { headers: ifMatchHeader },
      responses: {
        204: { description: 'Cleared' },
        ...authErrors,
        412: errorResponse('revision_mismatch'),
      },
    }),
    (c) => {
      core.queue.clear(expectedRevision(c))
      c.header('ETag', `"${core.queue.revision}"`)
      return c.body(null, 204)
    },
  )
}
