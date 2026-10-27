import type { EventBus } from '../events'
import type { Engine, NowPlaying, PlayerPatch, PlayerState, QueueItem } from '../schemas'
import { chooseSource } from '../stream/source-choice'
import type { HealthService } from './health'
import type { LibraryService } from './library'
import type { QueueService } from './queue'

/** Instructions to whichever engine is playing. Main routes them by `engine`. */
export type PlayerCommand =
  | {
      type: 'load'
      url: string
      engine: Engine
      nowPlaying: NowPlaying
      startMs: number
      play: boolean
    }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; positionMs: number }
  | { type: 'volume'; volume: number }
  | { type: 'stop' }

/** What an engine reports back. */
export type PlayerReport =
  | { type: 'progress'; positionMs: number; playing: boolean }
  | { type: 'ad'; active: boolean }
  | { type: 'ended' }
  | { type: 'error'; message: string }

const RESTART_THRESHOLD_MS = 3_000
const HISTORY_LIMIT = 50

/**
 * Owns playback state. The audio itself lives in the player renderer (or the
 * hidden YTM window); this service decides what plays and tells it via commands.
 */
export class PlayerService {
  private state: PlayerState
  private current: QueueItem | null = null
  private readonly history: QueueItem[] = []
  private send: (command: PlayerCommand) => void = () => {}

  constructor(
    private readonly queue: QueueService,
    private readonly library: LibraryService,
    private readonly health: HealthService,
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
  }

  /** Connects the transport that delivers commands to the engines. */
  connect(send: (command: PlayerCommand) => void): void {
    this.send = send
  }

  get(): PlayerState {
    return this.state
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
    return this.state
  }

  next(): PlayerState {
    if (this.current) {
      this.history.push(this.current)
      if (this.history.length > HISTORY_LIMIT) this.history.shift()
    }
    const item = this.queue.takeNext()
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
      this.queue.add({
        recordingId: this.current.recordingId,
        position: 'next',
        origin: this.current.origin,
      })
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
      case 'ended':
        this.ended()
        break
      case 'error':
        this.failed(report.message)
        break
    }
  }

  private start(item: QueueItem, startMs = 0, forceFallback = false): PlayerState {
    const choice = chooseSource(this.library.sources(item.recordingId), {
      pinnedSourceId: item.pinnedSourceId,
      directAllowed: !forceFallback && this.health.breaker.allowsDirect,
    })
    if (!choice) {
      // Nothing playable for this one; move on rather than stall the stream.
      this.current = item
      return this.next()
    }
    const nowPlaying: NowPlaying = {
      queueItemId: item.id,
      recording: item.recording,
      sourceId: choice.source.id,
      engine: choice.engine,
    }
    if (choice.engine === 'fallback') this.health.fallbackUsed()
    this.current = item
    this.send({
      type: 'load',
      url: `track://${choice.source.id}`,
      engine: choice.engine,
      nowPlaying,
      startMs,
      play: true,
    })
    const trackChanged = this.state.current?.queueItemId !== item.id
    this.update(
      {
        current: nowPlaying,
        playing: true,
        ad: false,
        positionMs: startMs,
        positionAt: this.now(),
      },
      trackChanged,
    )
    return this.state
  }

  private stop(): PlayerState {
    this.current = null
    this.send({ type: 'stop' })
    this.update(
      { current: null, playing: false, ad: false, positionMs: 0, positionAt: this.now() },
      true,
    )
    return this.state
  }

  private ended(): void {
    const item = this.current
    if (item && this.state.repeat === 'one') {
      this.start(item)
      return
    }
    if (item && this.state.repeat === 'all') {
      this.queue.add({ recordingId: item.recordingId, position: 'end', origin: item.origin })
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
