import { DURATION_TOLERANCE_MS, normalizeArtist, normalizeTitle } from '../library/match'

/** What the resolver compares: the link's song against a library or YTM candidate. */
export interface Comparable {
  title: string
  artists: string[]
  durationMs: number | null
  isrc?: string | null
}

/** At or above: play it without asking (PLAN §5 step 3). */
export const CONFIDENT = 0.9
/** Below this a candidate isn't worth showing. */
export const PLAUSIBLE = 0.6

/** Video-only decorations that say nothing about which recording it is. */
const VIDEO_NOISE =
  /[([](?:official\s+(?:music\s+)?(?:video|audio|visuali[sz]er|lyric\s+video)|lyrics?(?:\s+video)?|audio|visuali[sz]er|hd|hq|4k|mv|m\/v)[)\]]/gi

/** Title normalisation for matching links, which also drops video decorations. */
export function linkTitle(title: string): string {
  return normalizeTitle(title.replace(VIDEO_NOISE, ' '))
}

/**
 * How likely `b` is the recording `a` describes, from 0 to 1 (PLAN §5):
 * - matching ISRCs settle it; differing ones (e.g. a remaster) cap it below confident;
 * - durations more than 3 s apart rule it out; an unknown one keeps it below confident;
 * - otherwise Jaro-Winkler similarity of title (65%) and best artist pair (35%).
 */
export function scoreMatch(a: Comparable, b: Comparable): number {
  if (a.isrc && b.isrc && a.isrc.toUpperCase() === b.isrc.toUpperCase()) return 1
  if (a.durationMs !== null && b.durationMs !== null) {
    if (Math.abs(a.durationMs - b.durationMs) > DURATION_TOLERANCE_MS) return 0
  }
  const titleA = linkTitle(a.title)
  const titleB = linkTitle(b.title)
  let title = jaroWinkler(titleA, titleB)
  // Jaro-Winkler forgives words tacked on the end, but "(Radio Edit)", "(Live)" or
  // "(Remix)" make another recording: extra words keep it below confident.
  if (titleA !== titleB && extraWords(titleA, titleB)) title = Math.min(title, 0.8)
  let artist = 0
  for (const x of a.artists) {
    for (const y of b.artists)
      artist = Math.max(artist, jaroWinkler(normalizeArtist(x), normalizeArtist(y)))
  }
  let score = 0.65 * title + 0.35 * artist
  // PLAN §5 wants durations confirmed; without one a fuzzy match can only be a candidate.
  if (a.durationMs === null || b.durationMs === null) score *= 0.85
  if (a.isrc && b.isrc) score = Math.min(score, CONFIDENT - 0.05)
  return Math.round(score * 1000) / 1000
}

/** Whether either title has words the other lacks. */
function extraWords(a: string, b: string): boolean {
  const wa = new Set(a.split(' '))
  const wb = new Set(b.split(' '))
  return [...wa].some((w) => !wb.has(w)) || [...wb].some((w) => !wa.has(w))
}

/** Jaro-Winkler similarity, 0 to 1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0
  if (!a.length || !b.length) return 0
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatched = new Array<boolean>(a.length).fill(false)
  const bMatched = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const from = Math.max(0, i - window)
    const to = Math.min(b.length - 1, i + window)
    for (let j = from; j <= to; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue
      aMatched[i] = bMatched[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let transpositions = 0
  for (let i = 0, j = 0; i < a.length; i++) {
    if (!aMatched[i]) continue
    while (!bMatched[j]) j++
    if (a[i] !== b[j]) transpositions++
    j++
  }
  const m = matches
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3
  let prefix = 0
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}
