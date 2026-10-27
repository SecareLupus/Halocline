import { StreamError, YtmStreamer } from '@halocline/core'
import { app } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { YtmPageRuntime } from './ytm-runtime'

/**
 * Fixed tracks for the stream canary (PLAN §4): an official audio track (a
 * YouTube Music "song") and an official music video, both well past the
 * one-minute mark, so a rejected PO token can't pass on cold-start data alone.
 */
const VIDEO_IDS = ['fa5IWHDbftI', 'FGBhQbmPwH8']

interface Result {
  videoId: string
  ok: boolean
  step?: string
  error?: string
  bytes?: number
  expected?: number | null
  ms: number
}

/**
 * `halocline --test-stream`: runs the direct engine against `VIDEO_IDS`, reads
 * each track to the end and reports which step failed. Exits non-zero on any
 * failure, so CI can open an issue with the output.
 */
export async function runStreamSelfTest(): Promise<number> {
  const runtime = new YtmPageRuntime()
  const streamer = new YtmStreamer({
    runtime,
    cacheDir: join(app.getPath('temp'), 'halocline-player-cache'),
  })
  const results: Result[] = []
  for (const videoId of VIDEO_IDS) {
    const started = Date.now()
    try {
      const stream = await streamer.open(videoId)
      let bytes = 0
      try {
        for await (const chunk of stream.body) bytes += chunk.length
      } catch (err) {
        throw new StreamError('sabr', err)
      }
      const complete = stream.contentLength === null || bytes === stream.contentLength
      results.push({
        videoId,
        ok: complete,
        ...(!complete && { step: 'sabr', error: 'Stream ended early' }),
        bytes,
        expected: stream.contentLength,
        ms: Date.now() - started,
      })
    } catch (err) {
      results.push({
        videoId,
        ok: false,
        step: err instanceof StreamError ? err.step : 'unknown',
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      })
    }
  }
  runtime.destroy()
  const report = JSON.stringify({ ok: results.every((r) => r.ok), results }, null, 2)
  console.log(report)
  // CI reads the report from a file: Chromium's logs share the console.
  const reportPath = process.env['HALOCLINE_STREAM_REPORT']
  if (reportPath) writeFileSync(reportPath, report)
  return results.every((r) => r.ok) ? 0 : 1
}
