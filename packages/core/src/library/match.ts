/**
 * Deciding whether two descriptions are the same recording (PLAN §3): the same
 * song on disk and on YouTube Music becomes one Recording with two Sources.
 * ISRC decides when both have one; otherwise title and artist must agree after
 * normalising, and the durations must be close. It errs towards not merging:
 * a missed merge leaves a duplicate, a wrong one plays the wrong song.
 */

export interface SongIdentity {
  title: string
  artists: string[]
  durationMs: number | null
  isrc?: string | null
}

/** How far apart two durations may be for the same recording. */
export const DURATION_TOLERANCE_MS = 3000

/** Bracketed qualifiers that don't change which recording it is. */
const NEUTRAL_QUALIFIER =
  /^(?:\d{4} )?(?:remaster(?:ed)?(?: \d{4})?(?: version)?|explicit|clean|album version|single version|original mix|mono|stereo)$/

/** Lowercase, accents and punctuation removed, featured artists and neutral qualifiers dropped. */
export function normalizeTitle(title: string): string {
  let t = fold(title)
  // "Song (feat. X)", "Song [ft. X]", "Song feat. X"
  t = t.replace(/[([](?:feat|ft|featuring)\.?\s[^)\]]*[)\]]/g, ' ')
  t = t.replace(/\s(?:feat|ft|featuring)\.?\s.*$/, ' ')
  t = t.replace(/[([]([^)\]]*)[)\]]/g, (whole, inner: string) =>
    NEUTRAL_QUALIFIER.test(squash(inner)) ? ' ' : whole,
  )
  // "Song - Remastered 2011"
  t = t.replace(/\s-\s(.*)$/, (whole, tail: string) =>
    NEUTRAL_QUALIFIER.test(squash(tail)) ? ' ' : whole,
  )
  return squash(t)
}

export function normalizeArtist(artist: string): string {
  return squash(fold(artist).replace(/\s-\stopic$/, ''))
}

export function sameRecording(a: SongIdentity, b: SongIdentity): boolean {
  if (a.isrc && b.isrc) return a.isrc.toUpperCase() === b.isrc.toUpperCase()
  if (a.durationMs === null || b.durationMs === null) return false
  if (Math.abs(a.durationMs - b.durationMs) > DURATION_TOLERANCE_MS) return false
  if (normalizeTitle(a.title) !== normalizeTitle(b.title)) return false
  const artists = new Set(a.artists.map(normalizeArtist).filter(Boolean))
  return b.artists.some((artist) => artists.has(normalizeArtist(artist)))
}

const fold = (s: string) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/&/g, ' and ')

/** Punctuation to spaces, whitespace collapsed. */
const squash = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
