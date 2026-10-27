import type { Core } from '@halocline/core'
import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'

export const TRACK_SCHEME = 'track'

/** Must run before `app.ready`. */
export function registerTrackScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: TRACK_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
    },
  ])
}

/**
 * `track://<sourceId>` is the only URL the player ever plays (PLAN §2). What
 * sits behind it (a local file, a cached file, a direct YTM stream) is decided
 * here, so the player never needs to know.
 */
export function handleTrackProtocol(core: Core): void {
  protocol.handle(TRACK_SCHEME, async (request) => {
    const sourceId = new URL(request.url).hostname
    const source = core.library.source(sourceId)
    if (!source) return new Response('Unknown source', { status: 404 })
    switch (source.kind) {
      case 'local':
        // Forward Range headers so seeking works.
        return net.fetch(pathToFileURL(source.locator).toString(), { headers: request.headers })
      case 'ytm':
        return new Response('YouTube Music streaming is not implemented yet', { status: 501 })
    }
  })
}
