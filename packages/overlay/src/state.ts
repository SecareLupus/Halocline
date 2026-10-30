// The renderer's pure parts (PLAN §8): what to show for a player state, and when.

/** The parts of `PlayerState` the overlay reads, so fixtures and previews stay small. */
export interface OverlayTrack {
  title: string
  artists: string[]
  album: string | null
  durationMs: number | null
  artwork: string | null
}

export interface OverlayState {
  playing: boolean
  positionMs: number
  positionAt: number
  pausedAt: number | null
  ad: boolean
  current: { queueItemId: string; recording: OverlayTrack & { id: string } } | null
}

/**
 * Shown while a song plays or has been paused a while; hidden with nothing
 * playing, during an ad, or once a pause has lasted `hideAfterPausedMs`.
 */
export function isShown(
  state: OverlayState | null,
  hideAfterPausedMs: number | null,
  now: number,
): boolean {
  if (!state?.current || state.ad) return false
  if (state.playing || state.pausedAt === null || hideAfterPausedMs === null) return true
  return now - state.pausedAt <= hideAfterPausedMs
}

/** Marked paused even while fading out as stopped, so the paused look holds until it's gone. */
export function isPaused(state: OverlayState | null): boolean {
  return Boolean(state?.current) && !state?.playing
}

/** How far through the song, 0 to 1, moving on from the last event while playing. */
export function progress(state: OverlayState | null, now: number): number {
  const duration = state?.current?.recording.durationMs
  if (!state || !duration) return 0
  const elapsed = state.playing ? now - state.positionAt : 0
  return Math.min(1, Math.max(0, (state.positionMs + elapsed) / duration))
}

/** Changes when the song shown should cross-fade to another. */
export function trackKey(state: OverlayState | null): string | null {
  const current = state?.current
  return current ? current.queueItemId + ':' + current.recording.id : null
}

/** Fills `{title}`, `{artists}` and `{album}`; anything else is left as written. */
export function formatText(template: string, track: OverlayTrack): string {
  return template.replace(/\{(title|artists|album)\}/g, (_, field: string) =>
    field === 'title'
      ? track.title
      : field === 'artists'
        ? track.artists.join(', ')
        : (track.album ?? ''),
  )
}

/**
 * The font scale that fits a line `needed` px wide into `available` px, no smaller
 * than `min`. Text width is close to proportional to font size; a little under, to be sure.
 */
export function fitScale(available: number, needed: number, min: number): number {
  if (needed <= available) return 1
  return Math.max(min, (available / needed) * 0.98)
}

/** The scale that fits the canvas into a box, keeping its aspect ratio. */
export function canvasScale(
  box: { width: number; height: number },
  canvas: { width: number; height: number },
): number {
  return Math.min(box.width / canvas.width, box.height / canvas.height)
}
