// Track-to-track transition rules, shared by the core and the player renderer.
// Browser-safe: no Node imports.

export interface TransitionTrack {
  durationMs: number | null
  album: string | null
  artists: string[]
}

export interface TransitionSettings {
  crossfadeMs: number
  gaplessAlbums: boolean
}

/** Starting the next deck this early hides decoder start-up and timer jitter. */
export const GAPLESS_LEAD_MS = 15

const norm = (s: string) => s.trim().toLocaleLowerCase()

/** Consecutive tracks of one album: same album title and same lead artist. */
export function sameAlbum(a: TransitionTrack, b: TransitionTrack): boolean {
  if (!a.album || !b.album || norm(a.album) !== norm(b.album)) return false
  const artistA = a.artists[0]
  const artistB = b.artists[0]
  return !artistA || !artistB || norm(artistA) === norm(artistB)
}

/**
 * How long to crossfade from `current` into `next`. 0 means gapless. A fade
 * never takes more than a third of either track, so short tracks are still
 * heard on their own and the player has time to preload what follows.
 */
export function crossfadeFor(
  current: TransitionTrack,
  next: TransitionTrack,
  settings: TransitionSettings,
): number {
  if (settings.crossfadeMs <= 0) return 0
  if (settings.gaplessAlbums && sameAlbum(current, next)) return 0
  const limits = [current.durationMs, next.durationMs]
    .filter((d): d is number => d !== null && d > 0)
    .map((d) => d / 3)
  return Math.round(Math.min(settings.crossfadeMs, ...limits))
}

/** Equal-power fade curves, so loudness holds steady through a crossfade. */
export function equalPowerCurves(steps = 64): { fadeIn: Float32Array; fadeOut: Float32Array } {
  const fadeIn = new Float32Array(steps)
  const fadeOut = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    fadeIn[i] = Math.sin((t * Math.PI) / 2)
    fadeOut[i] = Math.cos((t * Math.PI) / 2)
  }
  return { fadeIn, fadeOut }
}
