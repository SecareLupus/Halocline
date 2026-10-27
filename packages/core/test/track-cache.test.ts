import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseRange, TrackCache, type AudioSource, type AudioStream, type Source } from '../src'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'halocline-cache-'))
  dirs.push(dir)
  return dir
}

const bytes = (n: number, seed = 0) => Uint8Array.from({ length: n }, (_, i) => (i + seed) % 251)

/** An audio source whose chunks are released by the test. */
function controlledSource(data: Uint8Array, chunk = 100) {
  const opened: string[] = []
  let push: (() => void) | null = null
  let fail: ((err: Error) => void) | null = null
  const source: AudioSource = {
    async open(videoId): Promise<AudioStream> {
      opened.push(videoId)
      let offset = 0
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          push = () => {
            if (offset >= data.length) return controller.close()
            controller.enqueue(data.slice(offset, offset + chunk))
            offset += chunk
          }
          fail = (err) => controller.error(err)
        },
      })
      return { mimeType: 'audio/webm; codecs="opus"', contentLength: data.length, body, abort() {} }
    },
  }
  return {
    source,
    opened,
    push: () => push?.(),
    fail: (err: Error) => fail?.(err),
    pushAll: () => {
      for (let i = 0; i <= data.length / chunk; i++) push?.()
    },
  }
}

const ytmSource = (videoId: string): Source => ({
  id: `src-${videoId}`,
  recordingId: 'rec',
  kind: 'ytm',
  locator: videoId,
  format: null,
  bitrate: null,
  available: true,
  failureCount: 0,
  lastChecked: null,
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('parseRange', () => {
  it('parses open, closed and suffix ranges', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual([0, 99])
    expect(parseRange('bytes=10-19', 100)).toEqual([10, 19])
    expect(parseRange('bytes=90-500', 100)).toEqual([90, 99])
    expect(parseRange('bytes=-10', 100)).toEqual([90, 99])
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('items=0-1', 100)).toBe('invalid')
  })
})

describe('TrackCache', () => {
  it('serves a track while it downloads, then from disk', async () => {
    const data = bytes(1000)
    const audio = controlledSource(data)
    const dir = tempDir()
    const cache = new TrackCache(audio.source, { dir, maxBytes: 1e9 })
    const source = ytmSource('abcdefghijk')

    const response = await cache.read('abcdefghijk', 'bytes=150-')
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 150-999/1000')
    expect(response.headers.get('Content-Type')).toBe('audio/webm')
    const body = response.arrayBuffer()
    audio.pushAll()
    expect(new Uint8Array(await body)).toEqual(data.slice(150))

    await tick()
    expect(cache.isCached(source)).toBe(true)
    expect(readdirSync(dir)).toEqual(['abcdefghijk.webm'])
    const again = await cache.read('abcdefghijk', null)
    expect(again.status).toBe(200)
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(data)
    expect(audio.opened).toEqual(['abcdefghijk'])
    await cache.close()
  })

  it('downloads a prefetched track once and finds it again after a restart', async () => {
    const audio = controlledSource(bytes(300))
    const dir = tempDir()
    const cache = new TrackCache(audio.source, { dir, maxBytes: 1e9 })
    cache.prefetch(ytmSource('prefetched1'))
    cache.prefetch(ytmSource('prefetched1'))
    await tick()
    audio.pushAll()
    await tick()
    expect(audio.opened).toEqual(['prefetched1'])

    writeFileSync(join(dir, 'leftover123.webm.part'), 'partial')
    const reopened = new TrackCache(audio.source, { dir, maxBytes: 1e9 })
    expect(reopened.isCached(ytmSource('prefetched1'))).toBe(true)
    expect(readdirSync(dir)).toEqual(['prefetched1.webm'])
  })

  it('fails readers and drops the partial file when the stream breaks', async () => {
    const audio = controlledSource(bytes(1000))
    const dir = tempDir()
    const cache = new TrackCache(audio.source, { dir, maxBytes: 1e9 })
    const response = await cache.read('brokenSong1', null)
    const body = response.arrayBuffer()
    audio.push()
    await tick()
    audio.fail(new Error('SABR stall'))
    await expect(body).rejects.toThrow()
    await tick()
    expect(cache.isCached(ytmSource('brokenSong1'))).toBe(false)
    expect(readdirSync(dir)).toEqual([])
  })

  it('evicts the least recently used tracks past the size limit', async () => {
    let now = 0
    const dir = tempDir()
    const open = async (): Promise<AudioStream> => ({
      mimeType: 'audio/webm',
      contentLength: 400,
      body: new Blob([bytes(400)]).stream(),
      abort() {},
    })
    const cache = new TrackCache({ open }, { dir, maxBytes: 1000, now: () => now })
    for (const id of ['first000001', 'second00001', 'third000001']) {
      now += 60 * 60_000
      cache.prefetch(ytmSource(id))
      await tick()
    }
    expect(readdirSync(dir).sort()).toEqual(['second00001.webm', 'third000001.webm'])
  })
})
