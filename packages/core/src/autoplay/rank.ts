import { normalizeArtist } from '../library/match'
import type { AudioFeatures } from '../schemas'

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
  /** How alike the two sound (CLAP embeddings): as strong as YTM's radio. */
  sound: 1,
  /** Tempo, allowing half and double time. */
  tempo: 0.3,
  /** Harmonic compatibility on the Camelot wheel. */
  key: 0.3,
  energy: 0.3,
  loudness: 0.1,
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

/** Cosine similarity of two unit-length embeddings, as a score. */
export function soundScore(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i]! * (b[i] ?? 0)
  // With this CLAP model, different kinds of music score below about 0.4, songs of
  // one style 0.6 to 0.75, and versions of one song above 0.9.
  return clamp((dot - 0.4) / 0.5)
}

/** 1 for the same tempo, falling to 0 at 8% apart; half and double time count as the same. */
export function tempoScore(a: number, b: number): number {
  const apart = Math.min(...[b / a, (2 * b) / a, b / (2 * a)].map((r) => Math.abs(Math.log(r))))
  return clamp(1 - apart / Math.log(1.08))
}

/**
 * Camelot compatibility: the same key; its relative major or minor and the keys
 * a fifth away mix smoothly (0.8); two steps away less so (0.4); otherwise 0.
 */
export function keyScore(a: string, b: string): number {
  const [na, la] = [Number.parseInt(a), a.at(-1)]
  const [nb, lb] = [Number.parseInt(b), b.at(-1)]
  const steps = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12)
  if (steps === 0) return la === lb ? 1 : 0.8
  if (steps === 1) return la === lb ? 0.8 : 0.4
  if (steps === 2 && la === lb) return 0.4
  return 0
}

/** Evidence from audio analysis, for whichever measurements both songs have. */
export function featureEvidence(seed: AudioFeatures, other: AudioFeatures): Evidence[] {
  const out: Evidence[] = []
  if (seed.embedding && other.embedding)
    out.push({ score: soundScore(seed.embedding, other.embedding), weight: WEIGHTS.sound })
  if (seed.bpm && other.bpm)
    out.push({ score: tempoScore(seed.bpm, other.bpm), weight: WEIGHTS.tempo })
  if (seed.camelotKey && other.camelotKey)
    out.push({ score: keyScore(seed.camelotKey, other.camelotKey), weight: WEIGHTS.key })
  if (seed.energy !== null && other.energy !== null)
    out.push({ score: 1 - Math.abs(seed.energy - other.energy), weight: WEIGHTS.energy })
  if (seed.loudnessLufs !== null && other.loudnessLufs !== null)
    out.push({
      score: clamp(1 - Math.abs(seed.loudnessLufs - other.loudnessLufs) / 10),
      weight: WEIGHTS.loudness,
    })
  return out
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))

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
