/** Pitch classes, sharps and flats alike, as semitones above C. */
const PITCH: Record<string, number> = {
  C: 0,
  'B#': 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  'E#': 5,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
}

/**
 * A key on the Camelot wheel (PLAN §7): "8B" is C major, "8A" A minor. Neighbouring
 * numbers, and A/B of the same number, are the keys that mix smoothly.
 */
export function camelotKey(key: string, scale: string): string | null {
  const pitch = PITCH[key]
  if (pitch === undefined) return null
  if (scale === 'major') return `${((((pitch * 7) % 12) + 8 - 1) % 12) + 1}B`
  if (scale === 'minor') return `${((((((pitch + 3) % 12) * 7) % 12) + 8 - 1) % 12) + 1}A`
  return null
}

/**
 * How energetic a track sounds, 0 to 1, from its loudness and how often notes or
 * beats start. A heuristic: loud, busy tracks score high; quiet, sparse ones low.
 */
export function energy(loudnessLufs: number, onsetsPerSecond: number): number {
  const loud = (loudnessLufs + 30) / 25 // -30 LUFS → 0, -5 LUFS → 1
  const busy = onsetsPerSecond / 6
  return Math.round(Math.min(1, Math.max(0, 0.6 * loud + 0.4 * busy)) * 1000) / 1000
}
