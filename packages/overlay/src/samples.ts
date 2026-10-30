// Made-up player states for the editor's preview (PLAN §8), covering the cases
// a layout has to survive: with and without a requester and a next song too.
import type { OverlayState, OverlayTrack } from './state'

export type SampleName = 'playing' | 'paused' | 'long' | 'no-art'

export const SAMPLES: { name: SampleName; label: string }[] = [
  { name: 'playing', label: 'Playing' },
  { name: 'paused', label: 'Paused' },
  { name: 'long', label: 'Long names' },
  { name: 'no-art', label: 'No art' },
]

/** A gradient square, so the preview shows where the art goes without a real cover. */
const SAMPLE_ART =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs><linearGradient id="g" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#5ccf9e"/><stop offset="1" stop-color="#3b2a7a"/>' +
      '</linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>' +
      '<circle cx="50" cy="50" r="18" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3"/>' +
      '</svg>',
  )

/** Who asked for each sample song, and what plays after it. */
const EXTRAS: Record<SampleName, Pick<OverlayState, 'next'> & { requestedBy: string | null }> = {
  playing: {
    requestedBy: 'SeaOtter42',
    next: {
      queueItemId: 'sample-next',
      recording: {
        title: 'Thermocline',
        artists: ['The Deep Water Band'],
        album: 'Fresh and Salt',
      },
      requestedBy: null,
    },
  },
  paused: { requestedBy: null, next: null },
  long: {
    requestedBy: 'AnEspeciallyLongTwitchUsername_ThatKeepsGoing',
    next: {
      queueItemId: 'sample-next',
      recording: {
        title: 'Another Song Title That Is Much Too Long for Most Layouts (Live at the Pier)',
        artists: ['Fourth Artist', 'Fifth Artist'],
        album: null,
      },
      requestedBy: 'SecondLongViewerName',
    },
  },
  'no-art': { requestedBy: null, next: null },
}

const TRACKS: Record<SampleName, OverlayTrack> = {
  playing: {
    title: 'Halocline',
    artists: ['The Deep Water Band'],
    album: 'Fresh and Salt',
    durationMs: 240_000,
    artwork: SAMPLE_ART,
  },
  paused: {
    title: 'Halocline',
    artists: ['The Deep Water Band'],
    album: 'Fresh and Salt',
    durationMs: 240_000,
    artwork: SAMPLE_ART,
  },
  long: {
    title: 'A Song Title Long Enough to Need Shrinking and Then an Ellipsis (Extended Mix)',
    artists: ['First Artist', 'Second Artist', 'A Third Featured Artist'],
    album: 'An Album With a Similarly Long Name, Deluxe Edition',
    durationMs: 480_000,
    artwork: SAMPLE_ART,
  },
  'no-art': {
    title: 'Untitled Demo',
    artists: ['Local File'],
    album: null,
    durationMs: 180_000,
    artwork: null,
  },
}

/** A sample state, a third of the way through its song; `playing` moves on from `now`. */
export function sampleState(name: SampleName, now = Date.now()): OverlayState {
  const track = TRACKS[name]
  const { requestedBy, next } = EXTRAS[name]
  const playing = name !== 'paused'
  return {
    playing,
    positionMs: Math.round((track.durationMs ?? 0) / 3),
    positionAt: now,
    pausedAt: playing ? null : now,
    ad: false,
    current: {
      queueItemId: `sample-${name}`,
      recording: { id: `sample-${name}`, ...track },
      requestedBy,
    },
    next,
  }
}
