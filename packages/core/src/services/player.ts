import { DomainError } from '../errors'
import type { EventBus } from '../events'
import type {
  Engine,
  NowPlaying,
  OutputState,
  PlayerPatch,
  PlayerState,
  QueueItem,
  Settings,
  Source,
} from '../schemas'
import { chooseSource } from '../stream/source-choice'
import type { TrackStore } from '../stream/track-cache'
import type { HealthService } from './health'
import type { LibraryService } from './library'
import type { YtmCatalog } from '../providers/ytm'
import type { QueueService } from './queue'
import type { SettingsService } from './settings'

/** A track ready for an engine to play. */
export interface TrackLoad {
  url: string
  engine: Engine
  nowPlaying: NowPlaying
}

/** Instructions to whichever engine is playing. Main routes them by `engine`. */
export type PlayerCommand =
  | ({ type: 'load'; startMs: number; play: boolean } & TrackLoad)
  /**
   * The track to play when the current one ends. The player preloads it and
   * starts it on its own, gapless or crossfaded, then reports `advanced`.
   * `null` withdraws an earlier cue.
   */
  | { type: 'cue'; next: TrackLoad | null }
  | { type: 'configure'; playback: Settings['playback'] }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; positionMs: number }
  | { type: 'volume'; volume: number }
  | { type: 'stop' }

/** What an engine reports back. */
export type PlayerReport =
  | {
      type: 'progress'
      positionMs: number
      playing: boolean
      /** The queue item actually playing, from engines that know it. */
      queueItemId?: string
    }
  | { type: 'ad'; active: boolean }
  /** The player moved on to the cued track by itself. */
  | { type: 'advanced'; queueItemId: string }
  | { type: 'ended' }
  | { type: 'error'; message: string }
  | { type: 'output'; state: OutputState }

const RESTART_THRESHOLD_MS = 3_000
/**
 * Progress from an engine playing something other than Now Playing is put right
 * after this long; shorter than this after a change, it's a report already on
 * its way when the change was sent.
 */
const DRIFT_GRACE_MS = 2_000
const HISTORY_LIMIT = 50

interface Cue {
  item: QueueItem
  load: TrackLoad
}

/**
 * Owns playback state. The audio itself lives in the player renderer (or the
 * hidden YTM window); this service decides what plays and tells it via commands.
 */
export class PlayerService {
  private state: PlayerState
  private current: QueueItem | null = null
  private cued: Cue | null = null
  private output: OutputState = { devices: [], activeDeviceId: '', error: null }
  private readonly history: QueueItem[] = []
  private send: (command: PlayerCommand) => void = () => {}
  /** Set while this service changes the queue itself, so it doesn't re-cue mid-change. */
  private busy = false
  /** On shuffle, the queue item picked to play next; kept so the cued track is the one played. */
  private shufflePick: string | null = null
  /** When the playing track last changed, for telling drift from reports in flight. */
  private switchedAt = 0
  private readonly now: () => number
  private readonly random: () => number

  constructor(
    private readonly queue: QueueService,
    private readonly library: LibraryService,
    private readonly settings: SettingsService,
    private readonly health: HealthService,
    private readonly ytm: YtmCatalog,
    private readonly tracks: TrackStore | null,
    private readonly events: EventBus,
    private readonly options: {
      now?: () => number
      /** For shuffle; tests pass a fixed one. */
      random?: () => number
      /** Where the volume is kept between runs. */
      volume?: { get(): number | null; set(volume: number): void }
    } = {},
  ) {
    this.now = options.now ?? (() => Date.now())
    this.random = options.random ?? (() => Math.random())
    this.state = {
      playing: false,
      positionMs: 0,
      positionAt: this.now(),
      volume: options.volume?.get() ?? 0.8,
      repeat: 'off',
      shuffle: false,
      ad: false,
      current: null,
    }
    events.subscribe((e) => {
      if (e.type === 'settings.changed') this.send({ type: 'configure', playback: e.data.playback })
      if (e.type === 'queue.changed' && !this.busy) this.recue()
      // Turning stream-safe mode on takes an untagged song off the air at once.
      if (e.type === 'settings.changed' && this.current && !this.allowed(this.current)) this.next()
    })
  }

  /** Connects the transport that delivers commands to the engines. */
  connect(send: (command: PlayerCommand) => void): void {
    this.send = send
    send({ type: 'configure', playback: this.settings.get().playback })
    send({ type: 'volume', volume: this.state.volume })
  }

  get(): PlayerState {
    return this.state
  }

  getOutput(): OutputState {
    return this.output
  }

  patch(patch: PlayerPatch): PlayerState {
    if (patch.volume !== undefined) {
      this.send({ type: 'volume', volume: patch.volume })
      this.options.volume?.set(patch.volume)
    }
    if (patch.positionMs !== undefined) this.send({ type: 'seek', positionMs: patch.positionMs })
    const { playing, positionMs, ...rest } = patch
    if (patch.shuffle !== undefined) this.shufflePick = null
    // Pressing play with nothing loaded starts the queue, with the other changes
    // (repeat, shuffle, volume) already in place.
    if (playing === true && !this.current) {
      if (Object.keys(rest).length) this.update(rest)
      return this.next()
    }
    if (playing !== undefined) this.send({ type: playing ? 'play' : 'pause' })
    this.update({
      ...rest,
      ...(playing !== undefined && { playing }),
      ...(positionMs !== undefined && { positionMs, positionAt: this.now() }),
    })
    if (patch.repeat !== undefined || patch.shuffle !== undefined) this.recue()
    return this.state
  }

  next(): PlayerState {
    return this.skip(true)
  }

  /**
   * Moves on to the next song: the queue's first, or a random one on shuffle. On
   * repeat, the song left goes back on the end, unless it failed (it would loop).
   */
  private skip(requeue: boolean): PlayerState {
    const done = this.current
    this.remember(done)
    let item = this.upNext()
    if (requeue) this.requeue(done)
    // With nothing else queued, repeat plays the song just put back.
    item ??= this.upNext()
    if (!item) return this.stop()
    const picked = item
    this.withQueue(() => this.queue.remove(picked.id))
    this.shufflePick = null
    return this.start(picked)
  }

  /** What plays next: the head of the queue, or on shuffle a random song, picked once. */
  private upNext(): QueueItem | undefined {
    if (!this.state.shuffle) return this.queue.peek()
    const items = this.queue.list().items
    const kept = items.find((i) => i.id === this.shufflePick)
    if (kept) return kept
    const pick = items[Math.floor(this.random() * items.length)]
    this.shufflePick = pick?.id ?? null
    return pick
  }

  /**
   * Repeat (all): a song that played goes back on the end of the queue when it's
   * done with, finished or skipped, keeping its requester and pinned source.
   */
  private requeue(item: QueueItem | null): void {
    if (!item || this.state.repeat !== 'all') return
    // Only a song that actually played: an unplayable one would loop forever.
    if (this.state.current?.queueItemId !== item.id) return
    try {
      this.withQueue(() =>
        this.queue.add({
          recordingId: item.recordingId,
          position: 'end',
          origin: item.origin,
          ...(item.requestedBy && { requestedBy: item.requestedBy }),
          ...(item.pinnedSourceId && { pinnedSourceId: item.pinnedSourceId }),
        }),
      )
    } catch (err) {
      // Stream-safe mode came on and it isn't tagged: it doesn't come round again.
      if (!(err instanceof DomainError && err.type === 'stream_safe_violation')) throw err
    }
  }

  previous(): PlayerState {
    const prev = this.history.pop()
    if (this.positionNow() > RESTART_THRESHOLD_MS || !prev) {
      this.send({ type: 'seek', positionMs: 0 })
      this.update({ positionMs: 0, positionAt: this.now() })
      return this.state
    }
    if (this.current) {
      const { recordingId, origin } = this.current
      this.withQueue(() => this.queue.add({ recordingId, position: 'next', origin }))
    }
    return this.start(prev)
  }

  report(report: PlayerReport): void {
    switch (report.type) {
      case 'progress':
        if (report.queueItemId && this.current && report.queueItemId !== this.current.id) {
          this.drifted(report.queueItemId)
          break
        }
        if (this.state.current?.engine === 'direct') this.health.directSucceeded()
        this.update({
          positionMs: report.positionMs,
          positionAt: this.now(),
          playing: report.playing,
        })
        break
      case 'ad':
        this.update({ ad: report.active })
        break
      case 'advanced':
        this.advanced(report.queueItemId)
        break
      case 'ended':
        this.ended()
        break
      case 'error':
        this.failed(report.message)
        break
      case 'output':
        this.output = report.state
        this.events.publish({ type: 'output.changed', data: report.state })
        break
    }
  }

  /**
   * The engine says it's playing a different queue item than Now Playing shows
   * (a race between it moving on and a change from here). Now Playing is what
   * people see, so the engine is put back on it, where it should be by now.
   */
  private drifted(playingId: string): void {
    if (this.now() - this.switchedAt < DRIFT_GRACE_MS || !this.current) return
    const load = this.prepare(this.current)
    console.warn(
      `[player] engine was playing queue item ${playingId}, not ${this.current.id}; resyncing`,
    )
    this.switchedAt = this.now()
    if (!load) return void this.skip(false)
    this.send({ type: 'load', ...load, startMs: this.positionNow(), play: this.state.playing })
    this.recue()
  }

  private start(item: QueueItem, startMs = 0, forceFallback = false): PlayerState {
    const load = this.allowed(item) ? this.prepare(item, forceFallback) : undefined
    if (!load) {
      // Nothing playable for this one; move on rather than stall the stream.
      this.current = item
      return this.skip(false)
    }
    if (load.engine === 'fallback') this.health.fallbackUsed()
    this.current = item
    this.switchedAt = this.now()
    this.send({ type: 'load', ...load, startMs, play: true })
    const trackChanged = this.state.current?.queueItemId !== item.id
    this.update(
      {
        current: load.nowPlaying,
        playing: true,
        ad: false,
        positionMs: startMs,
        positionAt: this.now(),
      },
      trackChanged,
    )
    this.recue()
    return this.state
  }

  private stop(): PlayerState {
    this.current = null
    this.cued = null
    this.send({ type: 'stop' })
    this.update(
      { current: null, playing: false, ad: false, positionMs: 0, positionAt: this.now() },
      true,
    )
    return this.state
  }

  /** The player started the cued track itself (gapless or crossfaded). */
  private advanced(queueItemId: string): void {
    let cue = this.cued
    if (!cue || cue.item.id !== queueItemId) {
      // It moved on to a track cued before a later change reached it. The current
      // song again (repeat-one) is fine as it is; a song still queued is what plays
      // now; anything else, the engine is put back on Now Playing.
      if (queueItemId === this.current?.id) {
        this.update({ positionMs: 0, positionAt: this.now() })
        return
      }
      const item = this.queue.list().items.find((i) => i.id === queueItemId)
      const load = item && this.prepare(item)
      if (!item || !load) {
        this.switchedAt = 0
        return this.drifted(queueItemId)
      }
      cue = { item, load }
    }
    this.cued = null
    this.switchedAt = this.now()
    const finished = this.current
    const repeatingOne = finished?.id === cue.item.id
    if (finished && !repeatingOne) {
      this.remember(finished)
      this.requeue(finished)
      this.withQueue(() => {
        // It was the next song when cued; it may have been removed since.
        try {
          this.queue.remove(cue.item.id)
        } catch (err) {
          if (!(err instanceof DomainError && err.type === 'not_found')) throw err
        }
      })
      this.shufflePick = null
    }
    this.current = cue.item
    this.update(
      {
        current: cue.load.nowPlaying,
        playing: true,
        ad: false,
        positionMs: 0,
        positionAt: this.now(),
      },
      !repeatingOne,
    )
    this.recue()
  }

  private ended(): void {
    const item = this.current
    if (item && this.state.repeat === 'one') {
      this.start(item)
      return
    }
    this.next()
  }

  /** In-track failover (PLAN §4): a direct failure resumes on the fallback at the same spot. */
  private failed(message: string): void {
    const item = this.current
    if (!item) return
    if (this.state.current?.engine === 'direct') {
      this.health.directFailed(message)
      this.start(item, this.positionNow(), true)
      return
    }
    this.skip(false)
  }

  /**
   * Tells the player what comes next so it can preload it: the current track
   * again on repeat-one, otherwise the next song (the queue's first, or the shuffle pick). The fallback engine
   * can't preload, so tracks headed there aren't cued. A cloud track cued for
   * the direct engine is prefetched to the cache (PLAN §4).
   */
  private recue(): void {
    if (!this.current) return
    const next = this.state.repeat === 'one' ? this.current : this.upNext()
    const load = next && this.allowed(next) ? this.prepare(next) : undefined
    const usable = next && load && load.engine !== 'fallback' ? { item: next, load } : null
    if (usable?.load.engine === 'direct') {
      const source = this.library.source(usable.load.nowPlaying.sourceId)
      if (source) this.tracks?.prefetch(source)
    }
    if (usable?.item.id === this.cued?.item.id && usable?.load.url === this.cued?.load.url) return
    this.cued = usable
    this.send({ type: 'cue', next: usable?.load ?? null })
  }

  /**
   * Stream-safe mode (PLAN §3) is checked when adding to the queue, and again
   * here: songs queued before the mode came on, or untagged since, are skipped.
   */
  private allowed(item: QueueItem): boolean {
    if (!this.settings.get().streamSafeMode) return true
    return this.library.get(item.recordingId)?.streamSafe ?? false
  }

  private prepare(item: QueueItem, forceFallback = false): TrackLoad | undefined {
    const tracks = this.tracks
    const choice = chooseSource(this.library.sources(item.recordingId), {
      pinnedSourceId: item.pinnedSourceId,
      directAllowed: !forceFallback && this.health.breaker.allowsDirect,
      ytmPlayable: this.ytm.status().playback,
      ...(tracks && { isCached: (source: Source) => tracks.isCached(source) }),
    })
    if (!choice) return undefined
    return {
      url: `track://${choice.source.id}`,
      engine: choice.engine,
      nowPlaying: {
        queueItemId: item.id,
        recording: item.recording,
        sourceId: choice.source.id,
        engine: choice.engine,
      },
    }
  }

  private withQueue<T>(change: () => T): T {
    this.busy = true
    try {
      return change()
    } finally {
      this.busy = false
    }
  }

  private remember(item: QueueItem | null): void {
    if (!item) return
    this.history.push(item)
    if (this.history.length > HISTORY_LIMIT) this.history.shift()
  }

  private positionNow(): number {
    const { playing, positionMs, positionAt } = this.state
    return playing ? positionMs + (this.now() - positionAt) : positionMs
  }

  private update(changes: Partial<PlayerState>, trackChanged = false): void {
    this.state = { ...this.state, ...changes }
    // Play history: the History page, and autoplay (PLAN §7) avoids recent artists and songs.
    if (trackChanged && this.current) {
      this.library.markPlayed(this.current.recordingId, new Date(), {
        ...(this.state.current && { engine: this.state.current.engine }),
        origin: this.current.origin,
        requestedBy: this.current.requestedBy,
      })
    }
    this.events.publish({
      type: trackChanged ? 'track.changed' : 'player.changed',
      data: this.state,
    })
  }
}
