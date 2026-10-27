import { serve, type ServerType } from '@hono/node-server'
import type { Core } from '@halocline/core'
import { createApi } from './app'

export interface RunningServer {
  url: string
  close(): Promise<void>
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

/** Starts the API on the configured address. Remote binding needs TLS, which isn't built yet. */
export function startApiServer(core: Core): Promise<RunningServer> {
  const { bindAddress, port } = core.settings.get().api
  if (!LOOPBACK.has(bindAddress)) {
    // PLAN §6: tokens must never cross the network over plain HTTP.
    throw new Error(`Binding to ${bindAddress} requires TLS, which is not implemented yet`)
  }
  const app = createApi(core)
  return new Promise((resolve) => {
    const server: ServerType = serve({ fetch: app.fetch, hostname: bindAddress, port }, (info) => {
      resolve({
        url: `http://${bindAddress}:${info.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
            // Open SSE streams would otherwise hold the server open.
            if ('closeAllConnections' in server) server.closeAllConnections()
          }),
      })
    })
  })
}
