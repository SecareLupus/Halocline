import { normalizeArtist } from '../library/match'

/**
 * One piece of evidence that a candidate suits what's playing: a score from 0 to
 * 1 and how much it counts. Candidates are scored on whatever evidence exists
 * for them, so analyzed and unanalyzed ones rank on one scale (PLAN §7).
 */
export interface Evidence {
  score: number
  weight: number
}

/** How much each kind of evidence counts. */
export const WEIGHTS = {
  /** YTM's radio order: its recommender standing in for an audio comparison. */
  radio: 1,
  /** The artist of what's playing, or of a recent song. */
  artist: 0.5,
  /** Shared library tags. */
  tags: 0.4,
} as const

/** A small nudge towards songs you've saved or own. */
const LIBRARY_BONUS = 0.05

/** Weighted mean of the evidence there is; none at all scores 0. */
export function combine(evidence: Evidence[], inLibrary: boolean): number {
  const total = evidence.reduce((n, e) => n + e.weight, 0)
  if (!total) return 0
  const mean = evidence.reduce((n, e) => n + e.score * e.weight, 0) / total
  return Math.min(1, mean + (inLibrary ? LIBRARY_BONUS : 0))
}

/** Position `rank` (0 = first) in a radio list of `length` songs, as a score. */
export const radioScore = (rank: number, length: number) => (length > 1 ? 1 - rank / length : 1)

/** 1 for an artist of the current song, 0.6 for one of a recent song, else 0. */
export function artistScore(artists: string[], current: string[], recent: string[]): number {
  const mine = new Set(artists.map(normalizeArtist))
  if (current.some((a) => mine.has(normalizeArtist(a)))) return 1
  if (recent.some((a) => mine.has(normalizeArtist(a)))) return 0.6
  return 0
}

/** Jaccard overlap of two tag lists, ignoring case. */
export function tagScore(a: string[], b: string[]): number {
  const x = new Set(a.map((t) => t.toLocaleLowerCase()))
  const y = new Set(b.map((t) => t.toLocaleLowerCase()))
  if (!x.size || !y.size) return 0
  const shared = [...x].filter((t) => y.has(t)).length
  return shared / (x.size + y.size - shared)
}

/**
 * Picks one of the best candidates (sorted best first). Adventurousness widens
 * the pool and flattens the odds: at 0 it's nearly always the top one, at 1 any
 * of the top 20 is about as likely. A little randomness keeps autoplay from
 * looping the same path (PLAN §7).
 */
export function pick<T extends { score: number }>(
  sorted: T[],
  adventurousness: number,
  random: () => number = Math.random,
): T | undefined {
  if (!sorted.length) return undefined
  const pool = sorted.slice(0, Math.max(1, Math.round(2 + adventurousness * 18)))
  const temperature = 0.03 + adventurousness * 0.5
  const top = pool[0]!.score
  const odds = pool.map((c) => Math.exp((c.score - top) / temperature))
  let roll = random() * odds.reduce((n, o) => n + o, 0)
  for (let i = 0; i < pool.length; i++) {
    roll -= odds[i]!
    if (roll < 0) return pool[i]
  }
  return pool.at(-1)
}
