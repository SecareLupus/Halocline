import { readLocalFile, type Core } from '@halocline/core'
import { net, protocol } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const TRACK_SCHEME = 'track'
export const ARTWORK_SCHEME = 'artwork'

/** Must run before `app.ready`. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: TRACK_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    { scheme: ARTWORK_SCHEME, privileges: { standard: true, secure: true } },
  ])
}

/** `artwork://<file>` serves cover art the scanner extracted, named by content hash. */
export function handleArtworkProtocol(artworkDir: string): void {
  protocol.handle(ARTWORK_SCHEME, (request) => {
    const name = new URL(request.url).hostname
    if (!/^[0-9a-f]{40}\.[a-z]+$/.test(name)) return new Response('Bad name', { status: 400 })
    return net.fetch(pathToFileURL(join(artworkDir, name)).toString())
  })
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
        // Byte ranges, so seeking works.
        return allowCors(await readLocalFile(source.locator, request.headers.get('range')))
      case 'ytm':
        // Served from the track cache, which downloads on first request (PLAN §4).
        if (!core.tracks) return new Response('No YouTube Music engine', { status: 501 })
        return allowCors(await core.tracks.read(source.locator, request.headers.get('range')))
    }
  })
}

/**
 * The player's pages are another origin than track://, and Web Audio outputs
 * only silence for media it isn't allowed to read. Only the app's own pages use
 * this scheme (the YouTube Music window has its own session).
 */
function allowCors(res: Response): Response {
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
