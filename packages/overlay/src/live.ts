import type { Overlay, OverlayDocument } from '@halocline/core/overlay'
import type { OverlayState } from './state'

const auth = (token: string) => '?token=' + encodeURIComponent(token)

/** Art the library scanner extracted comes from the API; cloud art is already a URL. */
export function apiArtworkUrl(token: string): (artwork: string) => string {
  return (artwork) =>
    artwork.startsWith('https://')
      ? artwork
      : '/v1/artwork/' + encodeURIComponent(artwork) + auth(token)
}

export interface LiveOptions {
  /** An overlay token. */
  token: string
  onState(state: OverlayState): void
  /** Also follows this overlay's document. */
  overlayId?: string
  /** Each new revision of the document; null once the overlay is deleted. */
  onDocument?(doc: OverlayDocument | null): void
}

/**
 * Follows the API with an overlay token: reads the player state (and the
 * overlay's document), then the event stream. Returns a function that disconnects.
 */
export function connectLive(options: LiveOptions): () => void {
  const { token, overlayId } = options
  // A refetch and an event can bring the same change; only newer revisions count.
  let revision = 0
  const takeOverlay = (overlay: Overlay) => {
    if (overlay.id !== overlayId || overlay.revision <= revision) return
    revision = overlay.revision
    options.onDocument?.(overlay.document)
  }

  async function refresh() {
    try {
      const [player, overlay] = await Promise.all([
        fetch('/v1/player' + auth(token)),
        overlayId ? fetch('/v1/overlays/' + encodeURIComponent(overlayId) + auth(token)) : null,
      ])
      // The document first, so there's something to draw the state with.
      if (overlay?.ok) takeOverlay((await overlay.json()) as Overlay)
      else if (overlay?.status === 404) options.onDocument?.(null)
      if (player.ok) options.onState((await player.json()) as OverlayState)
    } catch {
      // The event stream's reconnect calls this again.
    }
  }

  const events = new EventSource('/v1/events' + auth(token))
  let dropped = false
  const onState = (e: MessageEvent<string>) => options.onState(JSON.parse(e.data) as OverlayState)
  events.addEventListener('player.changed', onState)
  events.addEventListener('track.changed', onState)
  events.addEventListener('overlay.changed', (e) => takeOverlay(JSON.parse(e.data) as Overlay))
  events.addEventListener('overlay.deleted', (e) => {
    if ((JSON.parse(e.data) as { id: string }).id === overlayId) options.onDocument?.(null)
  })
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
