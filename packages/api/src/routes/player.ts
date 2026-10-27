import { PlayerPatch, PlayerState, type Core } from '@halocline/core'
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { requireScope, type ApiEnv } from '../auth'
import { authErrors } from '../problem'

const stateResponse = (description: string) => ({
  200: { description, content: { 'application/json': { schema: PlayerState } } },
  ...authErrors,
})

export function registerPlayer(app: OpenAPIHono<ApiEnv>, core: Core) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/player',
      tags: ['player'],
      summary: 'Current playback state',
      middleware: [requireScope('read', 'overlay')],
      responses: stateResponse('Player state'),
    }),
    (c) => c.json(core.player.get(), 200),
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/player',
      tags: ['player'],
      summary: 'Set playing, volume, position, repeat or shuffle',
      middleware: [requireScope('player:control')],
      request: {
        body: { content: { 'application/json': { schema: PlayerPatch } }, required: true },
      },
      responses: stateResponse('Updated player state'),
    }),
    (c) => c.json(core.player.patch(c.req.valid('json')), 200),
  )

  for (const action of ['next', 'previous'] as const) {
    app.openapi(
      createRoute({
        method: 'post',
        path: `/v1/player/${action}`,
        tags: ['player'],
        summary:
          action === 'next' ? 'Skip to the next track' : 'Restart, or go to the previous track',
        middleware: [requireScope('player:control')],
        responses: stateResponse('Updated player state'),
      }),
      (c) => c.json(core.player[action](), 200),
    )
  }
}
