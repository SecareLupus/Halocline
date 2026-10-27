import { DomainError, type Core } from '@halocline/core'
import { OpenAPIHono } from '@hono/zod-openapi'
import { authenticate, type ApiEnv } from './auth'
import { problem } from './problem'
import { registerEvents } from './routes/events'
import { registerLibrary } from './routes/library'
import { registerPlayer } from './routes/player'
import { registerQueue } from './routes/queue'
import { registerSearch } from './routes/search'
import { registerSystem } from './routes/system'

export function createApi(core: Core): OpenAPIHono<ApiEnv> {
  const app = new OpenAPIHono<ApiEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 'validation_failed', 'The request did not match the schema', {
          issues: result.error.issues,
        })
      }
    },
  })

  app.onError((err, c) => {
    if (err instanceof DomainError) return problem(c, err.type, err.message, err.details)
    console.error('[api]', err)
    return c.json({ type: 'internal', title: 'internal error', status: 500 }, 500)
  })
  app.notFound((c) => problem(c, 'not_found', `No route for ${c.req.method} ${c.req.path}`))

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
  })
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Halocline API',
      version: '1.0.0',
      description: 'Control Halocline: player, queue, search and a live event stream.',
    },
    security: [{ bearer: [] }],
  })

  app.use('/v1/*', authenticate(core))
  registerPlayer(app, core)
  registerQueue(app, core)
  registerSearch(app, core)
  registerLibrary(app, core)
  registerSystem(app, core)
  registerEvents(app, core)
  return app
}
