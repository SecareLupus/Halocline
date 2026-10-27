// The contract between main and the hidden YouTube Music window (the fallback
// engine, PLAN §4). Main pushes the whole target state on every change; the
// window's preload reconciles the page's <video> element towards it.

export interface YtmEngineState {
  /** Bumped on every load, so a reload of the same video counts as new. */
  loadId: number
  /** Null when stopped. */
  videoId: string | null
  /** Where to start once the song itself (not an ad) is playing. */
  startMs: number
  playing: boolean
  volume: number
  /** A one-shot seek, applied when `id` changes. */
  seek: { id: number; positionMs: number }
  /** Label of the output device; null for the system default. Device IDs differ per origin. */
  outputLabel: string | null
}

export const YTM_ENGINE_IPC = {
  /** invoke: the preload asks for the current state when a page loads. */
  hello: 'halocline:ytm-engine-hello',
  /** main → preload: the new state. */
  state: 'halocline:ytm-engine-state',
  /** preload → main: a `PlayerReport`. */
  report: 'halocline:ytm-engine-report',
} as const
