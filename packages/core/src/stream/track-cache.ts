import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { open, rename, unlink, utimes, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { Source } from '../schemas'
import type { AudioSource } from '../providers/ytm-stream'

/** The prefetch cache as the player sees it. */
export interface TrackStore {
  /** Whether the source's audio is fully on disk. */
  isCached(source: Source): boolean
  /** Starts downloading a track ahead of play. Errors surface when it's played. */
  prefetch(source: Source): void
}

interface Cached {
  file: string
  size: number
  mimeType: string
  usedAt: number
}

interface Download {
  file: string
  part: string
  mimeType: string
  /** Known up front unless YouTube didn't say; then known once done. */
  total: number | null
  written: number
  done: boolean
  error: Error | null
  ready: Promise<void>
  changed: Set<() => void>
  abort(): void
}

const EXTENSIONS: Record<string, string> = { webm: 'audio/webm', m4a: 'audio/mp4' }
const READ_CHUNK = 256 * 1024
/** Entries used this recently are never evicted (they may be playing). */
const EVICTION_GRACE_MS = 15 * 60_000

/**
 * Cloud tracks on disk (PLAN §4 prefetch cache). Each track is downloaded once
 * into `<videoId>.<ext>.part`, then renamed; reads are served as byte ranges and
 * wait for bytes still on their way, so playback can start before the download
 * finishes. Least recently used files go once the cache passes `maxBytes`.
 */
export class TrackCache implements TrackStore {
  private readonly cached = new Map<string, Cached>()
  private readonly downloads = new Map<string, Download>()

  constructor(
    private readonly audio: AudioSource,
    private readonly options: { dir: string; maxBytes: number; now?: () => number },
  ) {
    mkdirSync(options.dir, { recursive: true })
    for (const name of readdirSync(options.dir)) {
      const path = join(options.dir, name)
      const match = /^([\w-]{11})\.(webm|m4a)$/.exec(name)
      if (!match) {
        // Partial downloads from a previous run.
        rmSync(path, { force: true })
        continue
      }
      const stat = statSync(path)
      this.cached.set(match[1]!, {
        file: path,
        size: stat.size,
        mimeType: EXTENSIONS[match[2]!]!,
        usedAt: stat.mtimeMs,
      })
    }
  }

  isCached(source: Source): boolean {
    return source.kind === 'ytm' && this.cached.has(source.locator)
  }

  prefetch(source: Source): void {
    if (source.kind !== 'ytm' || this.cached.has(source.locator)) return
    this.download(source.locator).ready.catch(() => {})
  }

  /** Serves a track as a `Response`, honouring a `Range` header. */
  async read(videoId: string, range: string | null): Promise<Response> {
    const cached = this.cached.get(videoId)
    if (cached) {
      this.touch(videoId, cached)
      return this.respond(cached.file, cached.mimeType, cached.size, range, null)
    }
    const download = this.download(videoId)
    try {
      await download.ready
      if (download.total === null) await this.finished(download)
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 502 })
    }
    return this.respond(download.part, download.mimeType, download.total!, range, download)
  }

  /** Stops downloads and removes their partial files. */
  async close(): Promise<void> {
    for (const download of this.downloads.values()) {
      download.abort()
      await unlink(download.part).catch(() => {})
    }
    this.downloads.clear()
  }

  private download(videoId: string): Download {
    const existing = this.downloads.get(videoId)
    if (existing) return existing

    let markReady!: () => void
    let failReady!: (err: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve
      failReady = reject
    })
    const download: Download = {
      file: '',
      part: '',
      mimeType: '',
      total: null,
      written: 0,
      done: false,
      error: null,
      ready,
      changed: new Set(),
      abort: () => {},
    }
    this.downloads.set(videoId, download)
    const notify = () => {
      for (const listener of download.changed) listener()
    }

    void (async () => {
      let handle: FileHandle | null = null
      try {
        const stream = await this.audio.open(videoId)
        download.abort = stream.abort
        const ext = stream.mimeType.includes('webm') ? 'webm' : 'm4a'
        download.file = join(this.options.dir, `${videoId}.${ext}`)
        download.part = `${download.file}.part`
        download.mimeType = EXTENSIONS[ext]!
        download.total = stream.contentLength
        handle = await open(download.part, 'w')
        markReady()
        for await (const chunk of stream.body) {
          await handle.write(chunk)
          download.written += chunk.length
          notify()
        }
        await handle.close()
        handle = null
        if (download.total !== null && download.written !== download.total) {
          throw new Error(`Stream ended at ${download.written} of ${download.total} bytes`)
        }
        download.total = download.written
        await rename(download.part, download.file)
        download.done = true
        this.cached.set(videoId, {
          file: download.file,
          size: download.written,
          mimeType: download.mimeType,
          usedAt: this.now(),
        })
        this.downloads.delete(videoId)
        notify()
        await this.evict()
      } catch (err) {
        download.error = err instanceof Error ? err : new Error(String(err))
        download.abort()
        await handle?.close().catch(() => {})
        if (download.part) await unlink(download.part).catch(() => {})
        this.downloads.delete(videoId)
        failReady(download.error)
        notify()
      }
    })()
    return download
  }

  private finished(download: Download): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (download.error) reject(download.error)
        else if (download.done) resolve()
        else return
        download.changed.delete(check)
      }
      download.changed.add(check)
      check()
    })
  }

  private respond(
    path: string,
    mimeType: string,
    size: number,
    range: string | null,
    download: Download | null,
  ): Response {
    const parsed = parseRange(range, size)
    if (parsed === 'invalid') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const [start, end] = parsed ?? [0, size - 1]
    const headers = new Headers({
      'Content-Type': mimeType,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    })
    if (parsed) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    return new Response(byteStream(path, start, end + 1, download), {
      status: parsed ? 206 : 200,
      headers,
    })
  }

  private touch(videoId: string, cached: Cached): void {
    cached.usedAt = this.now()
    const at = new Date(cached.usedAt)
    void utimes(cached.file, at, at).catch(() => {})
    this.cached.set(videoId, cached)
  }

  private async evict(): Promise<void> {
    let total = 0
    for (const entry of this.cached.values()) total += entry.size
    const oldest = [...this.cached.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)
    for (const [videoId, entry] of oldest) {
      if (total <= this.options.maxBytes) break
      if (this.now() - entry.usedAt < EVICTION_GRACE_MS) break
      this.cached.delete(videoId)
      total -= entry.size
      await unlink(entry.file).catch(() => {})
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

/** `[start, end]` inclusive, `null` for no range, or 'invalid'. Only single ranges. */
export function parseRange(
  header: string | null,
  size: number,
): [number, number] | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return 'invalid'
  let start: number
  let end: number
  if (!match[1]) {
    // Suffix range: the last N bytes.
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  }
  if (start > end || start >= size) return 'invalid'
  return [start, end]
}

/**
 * Reads `[start, end)` from a file that may still be downloading, waiting for
 * bytes that haven't arrived. The partial file is renamed when complete, so a
 * read that opens late falls back to the final name.
 */
function byteStream(
  path: string,
  start: number,
  end: number,
  download: Download | null,
): ReadableStream<Uint8Array> {
  let handle: FileHandle | null = null
  let position = start

  const available = async (): Promise<number> => {
    if (!download || download.done) return end
    for (;;) {
      if (download.error) throw download.error
      if (download.written > position || download.done) return Math.min(end, download.written)
      await new Promise<void>((resolve) => {
        const wake = () => {
          download.changed.delete(wake)
          resolve()
        }
        download.changed.add(wake)
      })
    }
  }

  const close = async () => {
    await handle?.close().catch(() => {})
    handle = null
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (position >= end) {
          await close()
          controller.close()
          return
        }
        const limit = await available()
        handle ??= await open(path, 'r').catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT' && download) return open(download.file, 'r')
          throw err
        })
        const length = Math.min(READ_CHUNK, limit - position)
        const buffer = new Uint8Array(length)
        const { bytesRead } = await handle.read(buffer, 0, length, position)
        if (bytesRead === 0) throw new Error('Track file is shorter than expected')
        position += bytesRead
        controller.enqueue(buffer.subarray(0, bytesRead))
      } catch (err) {
        await close()
        controller.error(err)
      }
    },
    cancel: close,
  })
}
