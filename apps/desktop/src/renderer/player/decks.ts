import type { PlayerCommand, PlayerReport } from '@halocline/core'

/**
 * Two `<audio>` decks on one AudioContext (PLAN §2). Loading a track uses the
 * idle deck and fades between them, which gives gapless playback and crossfade.
 * Output device selection (`AudioContext.setSinkId`) hooks in at `context`; not wired yet.
 */
export class Decks {
  private readonly context = new AudioContext()
  private readonly master = this.context.createGain()
  private readonly decks: Deck[]
  private active = 0
  private crossfadeMs = 0

  constructor(private readonly report: (report: PlayerReport) => void) {
    this.master.connect(this.context.destination)
    this.decks = [this.createDeck(), this.createDeck()]
  }

  handle(command: PlayerCommand): void {
    switch (command.type) {
      case 'load':
        return this.load(command.url, command.startMs, command.play)
      case 'play':
        void this.context.resume()
        void this.current.audio.play()
        return
      case 'pause':
        this.current.audio.pause()
        return
      case 'seek':
        this.current.audio.currentTime = command.positionMs / 1000
        return
      case 'volume':
        this.master.gain.setTargetAtTime(command.volume, this.context.currentTime, 0.02)
        return
      case 'stop':
        for (const deck of this.decks) unload(deck.audio)
        return
    }
  }

  private get current(): Deck {
    return this.decks[this.active]!
  }

  private load(url: string, startMs: number, play: boolean): void {
    const outgoing = this.current
    this.active = 1 - this.active
    const incoming = this.current
    const now = this.context.currentTime
    const fade = this.crossfadeMs / 1000

    incoming.audio.src = url
    incoming.audio.currentTime = startMs / 1000
    incoming.gain.gain.cancelScheduledValues(now)
    incoming.gain.gain.setValueAtTime(fade ? 0 : 1, now)
    incoming.gain.gain.linearRampToValueAtTime(1, now + fade)
    outgoing.gain.gain.cancelScheduledValues(now)
    outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, now)
    outgoing.gain.gain.linearRampToValueAtTime(0, now + fade)
    setTimeout(() => unload(outgoing.audio), this.crossfadeMs)

    if (play) {
      void this.context.resume()
      incoming.audio
        .play()
        .catch((err: unknown) => this.report({ type: 'error', message: String(err) }))
    }
  }

  private createDeck(): Deck {
    const audio = new Audio()
    audio.preload = 'auto'
    const gain = this.context.createGain()
    this.context.createMediaElementSource(audio).connect(gain).connect(this.master)
    const deck = { audio, gain }

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
    audio.addEventListener('ended', () => isActive() && this.report({ type: 'ended' }))
    audio.addEventListener('error', () => {
      if (isActive() && audio.src)
        this.report({ type: 'error', message: audio.error?.message ?? 'Playback error' })
    })
    return deck
  }
}

interface Deck {
  audio: HTMLAudioElement
  gain: GainNode
}

function unload(audio: HTMLAudioElement): void {
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
}
