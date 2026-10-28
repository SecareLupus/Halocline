import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { parseRange } from './track-cache'

/** Content types for the formats the scanner picks up. */
const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
}

/**
 * A local file as an HTTP-style response, honouring byte ranges. The player
 * only lets you seek in media whose server answers ranges with 206 and
 * Content-Range, which Electron's file:// fetch doesn't send.
 */
export async function readLocalFile(path: string, range: string | null): Promise<Response> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return new Response('Not found', { status: 404 })
  const size = info.size
  const parsed = parseRange(range, size)
  if (parsed === 'invalid') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const [start, end] = parsed ?? [0, size - 1]
  const headers = new Headers({
    'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(size ? end - start + 1 : 0),
    'Accept-Ranges': 'bytes',
  })
  if (parsed) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  const body = size
    ? (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>)
    : null
  return new Response(body, { status: parsed ? 206 : 200, headers })
}
