import type { Core, EventType, StampedEvent } from '@halocline/core'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import { isOverlayOnly, requireScope, type ApiEnv } from '../auth'

const OVERLAY_EVENTS: ReadonlySet<EventType> = new Set([
  'player.changed',
  'track.changed',
  'overlay.changed',
  'overlay.deleted',
])
const KEEPALIVE_MS = 15_000

/**
 * Server-Sent Events. Reconnecting clients send `Last-Event-ID` and get what
 * they missed, or a `resync` event telling them to refetch state.
 */
export function registerEvents(app: OpenAPIHono<ApiEnv>, core: Core) {
  app.get('/v1/events', requireScope('read', 'overlay'), (c) => {
    const allowed = isOverlayOnly(c.get('token'))
      ? (e: StampedEvent) => OVERLAY_EVENTS.has(e.type)
      : () => true
    const lastId = Number(c.req.header('Last-Event-ID') ?? NaN)

    return streamSSE(c, async (stream) => {
      const send = (e: StampedEvent) =>
        stream.writeSSE({ id: String(e.id), event: e.type, data: JSON.stringify(e.data) })

      // Buffer live events until the replay is written, so ordering holds.
      const pending: StampedEvent[] = []
      let live = false
      const unsubscribe = core.events.subscribe((e) => {
        if (!allowed(e)) return
        if (live) void send(e)
        else pending.push(e)
      })

      if (Number.isInteger(lastId)) {
        const missed = core.events.since(lastId)
        if (missed) for (const e of missed.filter(allowed)) await send(e)
        else await stream.writeSSE({ event: 'resync', data: '{}' })
      }
      for (const e of pending) await send(e)
      live = true

      const keepalive = setInterval(() => void stream.write(': keepalive\n\n'), KEEPALIVE_MS)
      stream.onAbort(() => {
        clearInterval(keepalive)
        unsubscribe()
      })
      // Hold the stream open until the client goes away.
      await new Promise<void>((resolve) => stream.onAbort(resolve))
    })
  })
}
