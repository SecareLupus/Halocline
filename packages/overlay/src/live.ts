import type { OverlayView } from './render'
import type { OverlayState } from './state'

const auth = (token: string) => '?token=' + encodeURIComponent(token)

/** Art the library scanner extracted comes from the API; cloud art is already a URL. */
export function apiArtworkUrl(token: string): (artwork: string) => string {
  return (artwork) =>
    artwork.startsWith('https://')
      ? artwork
      : '/v1/artwork/' + encodeURIComponent(artwork) + auth(token)
}

/**
 * Feeds a view from the API with an overlay token: the player state, then the
 * event stream. Returns a function that disconnects.
 */
export function connectLive(view: OverlayView, token: string): () => void {
  async function refresh() {
    try {
      const res = await fetch('/v1/player' + auth(token))
      if (res.ok) view.setState((await res.json()) as OverlayState)
    } catch {
      // The event stream's reconnect calls this again.
    }
  }

  const events = new EventSource('/v1/events' + auth(token))
  let dropped = false
  const onState = (e: MessageEvent<string>) => view.setState(JSON.parse(e.data) as OverlayState)
  events.addEventListener('player.changed', onState)
  events.addEventListener('track.changed', onState)
  events.addEventListener('resync', () => void refresh())
  events.addEventListener('error', () => {
    dropped = true
  })
  events.addEventListener('open', () => {
    if (dropped) void refresh()
    dropped = false
  })

  void refresh()
  return () => events.close()
}
