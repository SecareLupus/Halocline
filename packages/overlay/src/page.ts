// The OBS Browser Source page (PLAN §8), the same for every overlay. The API
// inlines this bundle into it; the overlay's id and token come from the address,
// /overlay/<id>?token=…, and its document from the API, redrawn as it's edited.
import { apiArtworkUrl, connectLive } from './live'
import { mountOverlay, type OverlayView } from './render'
import type { OverlayState } from './state'

const token = new URLSearchParams(location.search).get('token') ?? ''
const overlayId = decodeURIComponent(location.pathname.split('/').pop() ?? '')
const root = document.createElement('div')
document.body.append(root)

let view: OverlayView | null = null
let state: OverlayState | null = null

connectLive({
  token,
  overlayId,
  onDocument(doc) {
    if (!doc) {
      // Deleted: draw nothing.
      view?.destroy()
      view = null
    } else if (view) {
      view.setDocument(doc)
    } else {
      view = mountOverlay(root, doc, { artworkUrl: apiArtworkUrl(token) })
      view.setState(state)
    }
  },
  onState(next) {
    state = next
    view?.setState(next)
  },
})
