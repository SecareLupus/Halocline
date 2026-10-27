import type { PlayerCommand, PlayerReport, Settings, TrackLoad } from '@halocline/core'
import { crossfadeFor, equalPowerCurves, GAPLESS_LEAD_MS } from '@halocline/core/playback'
import { OutputRouter } from './output'

type PlaybackSettings = Settings['playback']

/** How often the transition timer looks at the playing deck. */
const TICK_MS = 50
/** Once the transition is this close, hand over to a precise one-shot timer. */
const SCHEDULE_WINDOW_MS = 400
/** A short fade on manual skips avoids clicks. */
const SKIP_FADE_MS = 120

const { fadeIn, fadeOut } = equalPowerCurves()

/**
 * Two `<audio>` decks on one AudioContext (PLAN §2). The core cues the next
 * track; it's preloaded on the idle deck and started just before the playing
 * one ends, gapless or with an equal-power crossfade, and the core is told via
 * `advanced`. The whole graph goes to one output device (`setSinkId`).
 */
export class Decks {
  private readonly context = new AudioContext()
  private readonly master = this.context.createGain()
  private readonly decks: [Deck, Deck]
  private active = 0
  /** `loaded` is false while the cue waits for its deck to finish fading out. */
  private cue: { deck: Deck; load: TrackLoad; loaded: boolean } | null = null
  private playing: TrackLoad | null = null
  private settings: PlaybackSettings = { outputDeviceId: '', crossfadeMs: 0, gaplessAlbums: true }
  private scheduled: ReturnType<typeof setTimeout> | null = null
  private readonly output: OutputRouter

  constructor(private readonly report: (report: PlayerReport) => void) {
    this.master.connect(this.context.destination)
    this.decks = [this.createDeck(), this.createDeck()]
    this.output = new OutputRouter(this.context, (state) => report({ type: 'output', state }))
    setInterval(() => this.tick(), TICK_MS)
  }

  handle(command: PlayerCommand): void {
    switch (command.type) {
      case 'configure':
        this.settings = command.playback
        void this.output.select(command.playback.outputDeviceId)
        this.unschedule() // the fade length may have changed
        return
      case 'load':
        return this.load(command, command.startMs, command.play)
      case 'cue':
        return this.setCue(command.next)
      case 'play':
        void this.context.resume()
        void this.current.audio.play()
        return
      case 'pause':
        this.unschedule()
        this.finishFades()
        this.current.audio.pause()
        return
      case 'seek':
        this.unschedule()
        this.current.audio.currentTime = command.positionMs / 1000
        return
      case 'volume':
        this.master.gain.setTargetAtTime(command.volume, this.context.currentTime, 0.02)
        return
      case 'stop':
        this.unschedule()
        this.cue = null
        this.playing = null
        for (const deck of this.decks) {
          this.stopRetiring(deck)
          unload(deck)
        }
        return
    }
  }

  private get current(): Deck {
    return this.decks[this.active]!
  }

  private get idle(): Deck {
    return this.decks[1 - this.active]!
  }

  /** Starts a track now (a skip or the first track). Reuses the cued deck if it holds it. */
  private load(load: TrackLoad, startMs: number, play: boolean): void {
    this.unschedule()
    const cued = this.cue
    this.cue = null
    if (cued?.loaded && cued.load.url === load.url && startMs === 0) {
      return this.switchTo(cued.deck, load, SKIP_FADE_MS, play)
    }
    const deck = this.idle
    this.stopRetiring(deck)
    deck.audio.src = load.url
    deck.audio.currentTime = startMs / 1000
    this.switchTo(deck, load, SKIP_FADE_MS, play)
  }

  private setCue(next: TrackLoad | null): void {
    this.unschedule()
    if (this.cue && next?.url === this.cue.load.url) {
      this.cue = { ...this.cue, load: next }
      return
    }
    // The idle deck may still be fading out the previous track; if so, the
    // cue loads when that fade ends (see switchTo).
    const deck = this.idle
    const free = !deck.fadingOut
    if (free) unload(deck)
    this.cue = next && { deck, load: next, loaded: free }
    if (next && free) preload(deck, next.url)
  }

  /** Fades from the playing deck to `incoming` over `fadeMs`, then frees the old deck. */
  private switchTo(incoming: Deck, load: TrackLoad, fadeMs: number, play: boolean): void {
    const outgoing = this.current
    this.stopRetiring(incoming)
    this.active = this.decks.indexOf(incoming)
    this.playing = load
    const now = this.context.currentTime
    const fade = fadeMs / 1000
    const hasOutgoing =
      outgoing !== incoming && Boolean(outgoing.audio.src) && !outgoing.audio.paused

    incoming.gain.gain.cancelScheduledValues(now)
    if (fade > 0 && hasOutgoing) {
      incoming.gain.gain.setValueCurveAtTime(fadeIn, now, fade)
      outgoing.gain.gain.cancelScheduledValues(now)
      outgoing.gain.gain.setValueCurveAtTime(fadeOut, now, fade)
    } else {
      incoming.gain.gain.setValueAtTime(1, now)
    }
    if (outgoing !== incoming) {
      this.stopRetiring(outgoing)
      outgoing.fadingOut = true
      outgoing.retire = setTimeout(() => this.retire(outgoing), fadeMs + 50)
    }
    if (play) {
      void this.context.resume()
      incoming.audio.play().catch((err: unknown) => {
        if (this.current === incoming) this.report({ type: 'error', message: String(err) })
      })
    }
  }

  /** Moves to the cued track on our own, at the natural end of the current one. */
  private advance(fadeMs: number): void {
    this.scheduled = null
    const cue = this.cue
    if (!cue) return
    this.cue = null
    this.switchTo(cue.deck, cue.load, fadeMs, true)
    this.report({ type: 'advanced', queueItemId: cue.load.nowPlaying.queueItemId })
  }

  /**
   * Watches the playing deck and, close to the transition point, sets a one-shot
   * timer for it. The point is `fade` before the end (crossfade) or a few ms
   * before it (gapless). Media elements can't be sample-accurate, so gapless
   * here means a gap of a few milliseconds at most.
   */
  private tick(): void {
    const audio = this.current.audio
    if (this.scheduled || !this.cueReady() || !this.playing || audio.paused) return
    if (!Number.isFinite(audio.duration)) return
    const remainingMs = (audio.duration - audio.currentTime) * 1000
    // A cue that became ready late fades over whatever time is left.
    const fadeMs = Math.min(
      this.fadeFor(this.playing, this.cue!.load, audio.duration * 1000),
      Math.max(0, remainingMs - GAPLESS_LEAD_MS),
    )
    const startInMs = remainingMs - Math.max(fadeMs, GAPLESS_LEAD_MS)
    if (startInMs > SCHEDULE_WINDOW_MS) return
    this.scheduled = setTimeout(() => this.advance(fadeMs), Math.max(0, startInMs))
  }

  /** The cued track is loaded on its deck and can start without stalling. */
  private cueReady(): boolean {
    const cue = this.cue
    return Boolean(cue?.loaded && cue.deck.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)
  }

  private fadeFor(current: TrackLoad, next: TrackLoad, currentDurationMs: number): number {
    const a = current.nowPlaying.recording
    const b = next.nowPlaying.recording
    return crossfadeFor(
      { durationMs: a.durationMs ?? currentDurationMs, album: a.album, artists: a.artists },
      { durationMs: b.durationMs, album: b.album, artists: b.artists },
      this.settings,
    )
  }

  private unschedule(): void {
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = null
  }

  /** A deck has finished fading out: free it, then load any cue waiting for it. */
  private retire(deck: Deck): void {
    deck.fadingOut = false
    deck.retire = undefined
    if (this.current === deck) return
    unload(deck)
    if (this.cue?.deck === deck) {
      preload(deck, this.cue.load.url)
      this.cue.loaded = true
    }
  }

  private stopRetiring(deck: Deck): void {
    clearTimeout(deck.retire)
    deck.retire = undefined
    deck.fadingOut = false
  }

  /** Cuts any fade short: the playing deck to full, the other one retired at once. */
  private finishFades(): void {
    const now = this.context.currentTime
    this.current.gain.gain.cancelScheduledValues(now)
    this.current.gain.gain.setValueAtTime(1, now)
    if (this.idle.fadingOut) {
      this.stopRetiring(this.idle)
      this.retire(this.idle)
    }
  }

  private createDeck(): Deck {
    const audio = new Audio()
    audio.preload = 'auto'
    const gain = this.context.createGain()
    gain.gain.value = 0
    this.context.createMediaElementSource(audio).connect(gain).connect(this.master)
    const deck: Deck = { audio, gain, fadingOut: false, retire: undefined }

    const isActive = () => this.current === deck
    let lastReport = 0
    const progress = (force: boolean) => {
      if (!isActive()) return
      const now = performance.now()
      if (!force && now - lastReport < 1000) return
      lastReport = now
      this.report({
        type: 'progress',
        positionMs: Math.round(audio.currentTime * 1000),
        playing: !audio.paused,
      })
    }
    audio.addEventListener('timeupdate', () => progress(false))
    audio.addEventListener('playing', () => progress(true))
    audio.addEventListener('pause', () => progress(true))
    audio.addEventListener('seeked', () => progress(true))
    audio.addEventListener('ended', () => {
      if (!isActive()) return
      // The timer missed the transition (e.g. the cue loaded late): go now.
      // With no usable cue, the core starts the next track itself.
      if (this.cue?.loaded) this.advance(0)
      else this.report({ type: 'ended' })
    })
    audio.addEventListener('error', () => {
      if (!audio.src) return
      if (isActive()) {
        this.report({ type: 'error', message: audio.error?.message ?? 'Playback error' })
      } else if (this.cue?.deck === deck) {
        // A cue that can't load is dropped; the core starts the track itself on `ended`.
        this.cue = null
      }
    })
    return deck
  }
}

interface Deck {
  audio: HTMLAudioElement
  gain: GainNode
  /** Still audible as the outgoing side of a fade; not free for a new track yet. */
  fadingOut: boolean
  retire: ReturnType<typeof setTimeout> | undefined
}

/** Loads a track paused and silent, so it can start instantly later. */
function preload(deck: Deck, url: string): void {
  deck.audio.src = url
  deck.audio.currentTime = 0
  deck.audio.load()
}

function unload(deck: Deck): void {
  deck.audio.pause()
  deck.audio.removeAttribute('src')
  deck.audio.load()
  deck.gain.gain.cancelScheduledValues(0)
  deck.gain.gain.value = 0
}
