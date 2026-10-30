// The overlay renderer (PLAN §8): plain DOM, shared by the OBS page and the editor.
export { mountOverlay, type MountOptions, type OverlayView } from './render'
export { apiArtworkUrl, connectLive, type LiveOptions } from './live'
export * from './state'
export * from './editing'
export * from './samples'
export * from './geometry'
export { DocumentHistory } from './history'
