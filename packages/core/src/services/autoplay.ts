import {
  artistScore,
  combine,
  featureEvidence,
  pick,
  radioScore,
  tagScore,
  WEIGHTS,
  type Evidence,
} from '../autoplay/rank'
import { DomainError } from '../errors'
import type { EventBus } from '../events'
import { normalizeArtist, sameRecording, songTitle } from '../library/match'
import type { YtmCatalog } from '../providers/ytm'
import type { Recording, Settings, YtmSong } from '../schemas'
import type { AnalysisService } from './analysis'
import type { LibraryService } from './library'
import type { QueueService } from './queue'
import type { SettingsService } from './settings'

/** A song autoplay might add: a recording, or a YTM song not in the database yet. */
interface Candidate {
  key: string
  title: string
  recording?: Recording
  song?: YtmSong
  artists: string[]
  evidence: Evidence[]
  score: number
}

/** How many library songs to consider per fill, beyond YTM's radio. */
const LIBRARY_CANDIDATES = 50

/**
 * Keeps the queue going with songs like what's playing (PLAN §7). When the queue
 * runs shorter than the setting, it generates candidates (YTM's radio for the
 * current song, library songs by the same or recent artists or with shared
 * tags), scores them on the evidence there is, drops repeats, and picks from
 * the best with a little randomness.
 */
export class AutoplayService {
  private running: Promise<void> | null = null
  private followUp: Promise<void> | null = null
  private readonly unsubscribe: () => void
  /** The YTM song for a recording with no YTM source, found by search once. */
  private readonly radioSeeds = new Map<string, string | null>()

  constructor(
    private readonly library: LibraryService,
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
    private readonly ytm: YtmCatalog,
    private readonly analysis: AnalysisService,
    events: EventBus,
    private readonly options: {
      /** React to queue, track and settings changes; otherwise only `check()` fills. */
      watch?: boolean
      /** Whether the player is on repeat: the queue then cycles, and isn't topped up. */
      repeating?: () => boolean
      random?: () => number
      now?: () => number
    } = {},
  ) {
    const watched = new Set(['queue.changed', 'track.changed', 'settings.changed'])
    let repeat: string | undefined
    this.unsubscribe =
      options.watch === false
        ? () => {}
        : events.subscribe((e) => {
            if (watched.has(e.type)) void this.check()
            // Repeat turned off: the queue may need topping up again.
            else if (e.type === 'player.changed' && e.data.repeat !== repeat) {
              repeat = e.data.repeat
              void this.check()
            }
          })
  }

  stop(): void {
    this.unsubscribe()
  }

  /**
   * Tops the queue up if autoplay is on and the queue is short. Resolves when done.
   * A call during a fill gets one more fill after it, which sees the change that
   * prompted the call; calls during that wait share it.
   */
  check(): Promise<void> {
    if (this.running) {
      this.followUp ??= this.running.then(() => {
        this.followUp = null
        return this.check()
      })
      return this.followUp
    }
    this.running = this.fill()
      // A failed fill (YTM down, say) is retried on the next queue or track change.
      .catch(() => {})
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  private needed(settings: Settings): number {
    if (!settings.autoplay.enabled || this.options.repeating?.()) return 0
    return settings.autoplay.minQueueLength - this.queue.list().items.length
  }

  private async fill(): Promise<void> {
    const settings = this.settings.get()
    if (this.needed(settings) <= 0) return
    const { artistGap } = settings.autoplay
    // The song playing is the latest played: plays are counted when a track starts.
    const history = this.library.recentlyPlayed(Math.max(artistGap, 1))
    // New songs go at the end of the queue, so they follow on from the last song
    // queued; from the one playing when nothing is queued.
    const queued = this.queue.list().items.map((i) => i.recording)
    const seed = queued.at(-1) ?? history[0]
    if (!seed) return
    const around = [...history, ...queued].filter((r) => r.id !== seed.id)

    const candidates = await this.candidates(seed, around, settings)
    const chosen: Candidate[] = []
    // The queue may have changed while YTM answered.
    for (let n = this.needed(this.settings.get()); n > 0; n--) {
      // A new song goes after everything queued, so queued songs count as the ones
      // just before it: what's played, then what's waiting, in play order.
      const played = history.slice(0, Math.max(artistGap, 1)).reverse()
      const upcoming = this.queue.list().items.map((i) => i.recording)
      const before = [...played, ...upcoming]
      const recentArtists = artistGap ? before.slice(-artistGap).flatMap((r) => r.artists) : []
      // Another version of a song just heard or coming up (a remix, a cover) is a repeat.
      const recentSongs = new Set([...before, ...chosen].map((s) => songTitle(s.title)))
      const pool = this.eligible(candidates, recentArtists, recentSongs, settings).filter(
        (c) => !chosen.includes(c),
      )
      const next = pick(pool, settings.autoplay.adventurousness, this.options.random)
      if (!next) break
      chosen.push(next)
      try {
        const recordingId = next.recording?.id ?? this.library.ensureYtmSong(next.song!).id
        this.queue.add({ recordingId, origin: 'autoplay' })
      } catch (err) {
        // Stream-safe mode turned on in the meantime: try another.
        if (!(err instanceof DomainError && err.type === 'stream_safe_violation')) throw err
        n++
      }
    }
  }

  /** Every candidate with its evidence, scored and sorted best first. */
  /** `around`: the other songs just played or queued, whose artists count a little too. */
  private async candidates(
    seed: Recording,
    around: Recording[],
    settings: Settings,
  ): Promise<Candidate[]> {
    const byKey = new Map<string, Candidate>()
    const add = (key: string, base: Omit<Candidate, 'key' | 'evidence' | 'score'>) => {
      let c = byKey.get(key)
      if (!c) byKey.set(key, (c = { key, ...base, evidence: [], score: 0 }))
      return c
    }
    const recentArtists = around.flatMap((r) => r.artists)
    const relate = (c: Candidate) => {
      c.evidence.push({
        score: artistScore(c.artists, seed.artists, recentArtists),
        weight: WEIGHTS.artist,
      })
      if (c.recording?.tags.length && seed.tags.length) {
        c.evidence.push({ score: tagScore(c.recording.tags, seed.tags), weight: WEIGHTS.tags })
      }
    }

    // YTM's radio is evidence even in library-only or stream-safe mode: it ranks the
    // library songs it names. Only cloud songs need YTM to be playable.
    const radio = await this.radio(seed)
    radio.forEach((song, rank) => {
      const recording = this.library.sourceByLocator('ytm', song.videoId)
      const known = recording
        ? this.library.get(recording.recordingId)
        : this.library.findMatch(song, 'ytm')
      const c = known
        ? add(known.id, { recording: known, title: known.title, artists: known.artists })
        : add(`ytm:${song.videoId}`, { song, title: song.title, artists: song.artists })
      c.evidence.push({ score: radioScore(rank, radio.length), weight: WEIGHTS.radio })
    })
    for (const c of byKey.values()) relate(c)

    const streamSafe = settings.streamSafeMode
    // Library songs that sound like the seed, once both are analyzed.
    const seedFeatures = this.analysis.features([seed.id]).get(seed.id)
    const soundsLike = seedFeatures?.embedding
      ? this.analysis
          .nearest(seedFeatures.embedding, { limit: LIBRARY_CANDIDATES, streamSafe })
          .flatMap(({ recordingId }) => this.library.get(recordingId) ?? [])
      : []
    const related = this.library.libraryWhere({
      artists: [...seed.artists, ...recentArtists],
      tags: seed.tags,
      streamSafe,
      limit: LIBRARY_CANDIDATES,
    })
    // Some of anything, so autoplay never runs dry on a library with no neighbours.
    const any = this.library.libraryWhere({ streamSafe, limit: LIBRARY_CANDIDATES })
    for (const recording of [...soundsLike, ...related, ...any]) {
      if (byKey.has(recording.id)) continue
      relate(add(recording.id, { recording, title: recording.title, artists: recording.artists }))
    }

    const list = [...byKey.values()]
    if (seedFeatures) {
      const analyzed = this.analysis.features(list.flatMap((c) => c.recording?.id ?? []))
      for (const c of list) {
        const features = c.recording && analyzed.get(c.recording.id)
        if (features) c.evidence.push(...featureEvidence(seedFeatures, features))
      }
    }
    for (const c of list) c.score = combine(c.evidence, c.recording?.inLibrary ?? false)
    return list.sort((a, b) => b.score - a.score)
  }

  /**
   * The candidates allowed now. Stream-safe mode, the queue, and the songs playing
   * or just played (in any version) are hard limits; the artist gap and recent-play window give way, in that
   * order, rather than leave the queue empty.
   */
  private eligible(
    candidates: Candidate[],
    recentArtists: string[],
    recentSongs: Set<string>,
    settings: Settings,
  ) {
    const { autoplay, streamSafeMode } = settings
    const queued = new Set(this.queue.list().items.map((i) => i.recordingId))
    const current = this.library.recentlyPlayed(1)[0]?.id
    const cloudOk = autoplay.sources === 'all' && !streamSafeMode && this.ytm.status().playback
    const hard = candidates.filter((c) => {
      if (recentSongs.has(songTitle(c.title))) return false
      if (c.recording) {
        if (c.recording.id === current || queued.has(c.recording.id)) return false
        return !streamSafeMode || c.recording.streamSafe
      }
      return cloudOk && !this.library.sourceByLocator('ytm', c.song!.videoId)
    })
    const now = this.options.now?.() ?? Date.now()
    const cutoff = now - autoplay.recentHours * 3_600_000
    const fresh = (c: Candidate) => {
      const at = c.recording?.lastPlayedAt
      return !at || Date.parse(at) < cutoff
    }
    const avoid = new Set(recentArtists.map(normalizeArtist))
    const newArtist = (c: Candidate) => !c.artists.some((a) => avoid.has(normalizeArtist(a)))
    for (const rule of [(c: Candidate) => fresh(c) && newArtist(c), fresh]) {
      const allowed = hard.filter(rule)
      if (allowed.length) return allowed
    }
    return hard
  }

  /** YTM's radio for the seed, found through its YTM source or a search. */
  private async radio(seed: Recording): Promise<YtmSong[]> {
    const videoId = await this.radioSeed(seed)
    if (!videoId) return []
    return this.ytm.getRadio(videoId).catch(() => [])
  }

  private async radioSeed(seed: Recording): Promise<string | null> {
    const own = this.library.sources(seed.id).find((s) => s.kind === 'ytm')
    if (own) return own.locator
    if (this.radioSeeds.has(seed.id)) return this.radioSeeds.get(seed.id)!
    let songs: YtmSong[]
    try {
      songs = await this.ytm.searchSongs(`${seed.artists[0] ?? ''} ${seed.title}`, 5)
    } catch {
      return null // Not remembered: YTM may be back next time.
    }
    const found = songs.find((s) => sameRecording(seed, s))?.videoId ?? null
    this.radioSeeds.set(seed.id, found)
    return found
  }
}
