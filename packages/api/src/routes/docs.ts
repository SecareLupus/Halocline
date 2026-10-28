import type { OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'
import swaggerCss from 'swagger-ui-dist/swagger-ui.css?raw'
import swaggerJs from 'swagger-ui-dist/swagger-ui-bundle.js?raw'
import type { ApiEnv } from '../auth'

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Halocline API</title>
    <link rel="stylesheet" href="/docs/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-ui-bundle.js"></script>
    <script src="/docs/init.js"></script>
  </body>
</html>`

// "Authorize" takes an API token (Settings → API); it's kept in this browser so
// it survives a reload. "Try it out" sends real requests to this app.
const INIT = `window.ui = SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: true,
  displayRequestDuration: true,
  tryItOutEnabled: false,
})`

/** Everything from this app; Swagger UI styles some elements inline. */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"

/**
 * Human-readable API docs at /docs (PLAN §6): Swagger UI over /openapi.json,
 * served from the app itself rather than a CDN, so it works offline. No token
 * is needed to read it; trying requests out needs one.
 */
export function registerDocs(app: OpenAPIHono<ApiEnv>): void {
  const send = (body: string, type: string) => (c: Context) =>
    c.body(body, 200, {
      'Content-Type': type,
      'Content-Security-Policy': CSP,
      'Cache-Control': 'no-cache',
    })
  app.get('/docs', send(PAGE, 'text/html; charset=utf-8'))
  app.get('/docs/', (c) => c.redirect('/docs'))
  app.get('/docs/swagger-ui.css', send(swaggerCss, 'text/css; charset=utf-8'))
  app.get('/docs/swagger-ui-bundle.js', send(swaggerJs, 'text/javascript; charset=utf-8'))
  app.get('/docs/init.js', send(INIT, 'text/javascript; charset=utf-8'))
}
