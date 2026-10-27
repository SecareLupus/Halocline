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
  | { type: 'progress'; positionMs: number; playing: boolean }
  | { type: 'ad'; active: boolean }
  /** The player moved on to the cued track by itself. */
  | { type: 'advanced'; queueItemId: string }
  | { type: 'ended' }
  | { type: 'error'; message: string }
  | { type: 'output'; state: OutputState }

const RESTART_THRESHOLD_MS = 3_000
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

  constructor(
    private readonly queue: QueueService,
    private readonly library: LibraryService,
    private readonly settings: SettingsService,
    private readonly health: HealthService,
    private readonly ytm: YtmCatalog,
    private readonly tracks: TrackStore | null,
    private readonly events: EventBus,
    private readonly now: () => number = Date.now,
  ) {
    this.state = {
      playing: false,
      positionMs: 0,
      positionAt: now(),
      volume: 0.8,
      repeat: 'off',
      shuffle: false,
      ad: false,
      current: null,
    }
    events.subscribe((e) => {
      if (e.type === 'settings.changed') this.send({ type: 'configure', playback: e.data.playback })
      if (e.type === 'queue.changed' && !this.busy) this.recue()
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
    if (patch.volume !== undefined) this.send({ type: 'volume', volume: patch.volume })
    if (patch.positionMs !== undefined) this.send({ type: 'seek', positionMs: patch.positionMs })
    if (patch.playing === true && !this.current) return this.next()
    if (patch.playing !== undefined) this.send({ type: patch.playing ? 'play' : 'pause' })
    // Shuffle is stored but not applied until autoplay and queue ordering land.
    const { playing, positionMs, ...rest } = patch
    this.update({
      ...rest,
      ...(playing !== undefined && { playing }),
      ...(positionMs !== undefined && { positionMs, positionAt: this.now() }),
    })
    if (patch.repeat !== undefined) this.recue()
    return this.state
  }

  next(): PlayerState {
    this.remember(this.current)
    const item = this.withQueue(() => this.queue.takeNext())
    if (!item) return this.stop()
    return this.start(item)
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

  private start(item: QueueItem, startMs = 0, forceFallback = false): PlayerState {
    const load = this.prepare(item, forceFallback)
    if (!load) {
      // Nothing playable for this one; move on rather than stall the stream.
      this.current = item
      return this.next()
    }
    if (load.engine === 'fallback') this.health.fallbackUsed()
    this.current = item
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
    const cue = this.cued
    if (!cue || cue.item.id !== queueItemId) return
    this.cued = null
    const finished = this.current
    const repeatingOne = finished?.id === cue.item.id
    if (finished && !repeatingOne) {
      this.remember(finished)
      this.withQueue(() => {
        if (this.state.repeat === 'all') {
          const { recordingId, origin } = finished
          this.queue.add({ recordingId, position: 'end', origin })
        }
        // It was the queue head when cued; it may have been removed since.
        try {
          this.queue.remove(cue.item.id)
        } catch (err) {
          if (!(err instanceof DomainError && err.type === 'not_found')) throw err
        }
      })
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
    if (item && this.state.repeat === 'all') {
      const { recordingId, origin } = item
      this.withQueue(() => this.queue.add({ recordingId, position: 'end', origin }))
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
    this.next()
  }

  /**
   * Tells the player what comes next so it can preload it: the current track
   * again on repeat-one, otherwise the head of the queue. The fallback engine
   * can't preload, so tracks headed there aren't cued. A cloud track cued for
   * the direct engine is prefetched to the cache (PLAN §4).
   */
  private recue(): void {
    if (!this.current) return
    const next = this.state.repeat === 'one' ? this.current : this.queue.peek()
    const load = next && this.prepare(next)
    const usable = load && load.engine !== 'fallback' ? { item: next, load } : null
    if (usable?.load.engine === 'direct') {
      const source = this.library.source(usable.load.nowPlaying.sourceId)
      if (source) this.tracks?.prefetch(source)
    }
    if (usable?.item.id === this.cued?.item.id && usable?.load.url === this.cued?.load.url) return
    this.cued = usable
    this.send({ type: 'cue', next: usable?.load ?? null })
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
    this.events.publish({
      type: trackChanged ? 'track.changed' : 'player.changed',
      data: this.state,
    })
  }
}
