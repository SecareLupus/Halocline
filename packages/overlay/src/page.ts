// The OBS Browser Source page (PLAN §8). The API inlines this bundle into the
// page along with the document; the token comes from the page's address.
import type { OverlayDocument } from '@halocline/core/overlay'
import { apiArtworkUrl, connectLive } from './live'
import { mountOverlay } from './render'

const token = new URLSearchParams(location.search).get('token') ?? ''
const doc = JSON.parse(document.getElementById('hl-document')!.textContent!) as OverlayDocument
const root = document.createElement('div')
document.body.append(root)
connectLive(mountOverlay(root, doc, { artworkUrl: apiArtworkUrl(token) }), token)
