// Preload for the hidden music.youtube.com window (the fallback engine). It runs
// in an isolated world: it reads and drives the page's <video> element through
// the shared DOM, and exposes nothing to YouTube's scripts.
import type { PlayerReport } from '@halocline/core'
import { ipcRenderer } from 'electron'
import { YTM_ENGINE_IPC, type YtmEngineState } from '../shared/ytm-engine'

const TICK_MS = 250
const PROGRESS_MS = 1000
/** Song time (ads excluded) to wait for playback before giving up on a load. */
const START_TIMEOUT_MS = 20_000
/** Ticks without the ad marker before trusting the <video> to be the song. */
const SETTLE_TICKS = 2

let state: YtmEngineState | null = null
let startApplied = false
let seekApplied = 0
let ended = false
let adActive = false
let lastContentMs = 0
let lastProgressAt = 0
let waitingMs = 0
let settledTicks = 0
let lastPlayAttempt = 0
let sink: { element: HTMLVideoElement; label: string | null } | null = null

const report = (r: PlayerReport) => ipcRenderer.send(YTM_ENGINE_IPC.report, r)

const video = () => document.querySelector<HTMLVideoElement>('video')
/** YTM shares YouTube's player, which marks ads with these classes. */
const isAd = () =>
  Boolean(
    document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting'),
  )
/** YTM moves on to its own autoplay pick by changing the URL in place. */
const onTarget = () =>
  state?.videoId != null && new URLSearchParams(location.search).get('v') === state.videoId

ipcRenderer.on(YTM_ENGINE_IPC.state, (_event, next: YtmEngineState) => {
  if (state && next.loadId !== state.loadId) {
    // A new load navigates the window, which reloads this preload; nothing to carry.
    startApplied = false
    ended = false
  }
  state = next
})
void ipcRenderer.invoke(YTM_ENGINE_IPC.hello).then((initial: YtmEngineState) => {
  state ??= initial
  seekApplied = initial.seek.id
  lastContentMs = initial.startMs
})

// Media events don't bubble, but capture listeners on the document still see them.
document.addEventListener(
  'ended',
  (event) => {
    if (event.target !== video() || isAd() || !onTarget() || ended) return
    ended = true
    report({ type: 'ended' })
  },
  true,
)
document.addEventListener(
  'error',
  (event) => {
    const element = event.target
    if (!(element instanceof HTMLVideoElement) || isAd() || !onTarget()) return
    report({ type: 'error', message: element.error?.message || 'YouTube Music playback error' })
  },
  true,
)

setInterval(tick, TICK_MS)

function tick(): void {
  const v = video()
  if (!state || !v) return
  if (!onTarget() || ended) {
    // Stopped, finished, or YTM started its own next song: stay quiet.
    if (!v.paused) v.pause()
    return
  }
  applyVolume(v)
  void applyOutput(v)

  const ad = isAd()
  if (ad !== adActive) {
    adActive = ad
    report({ type: 'ad', active: ad })
    // Freeze the song's clock while the ad plays.
    if (ad) report({ type: 'progress', positionMs: lastContentMs, playing: false })
  }
  // Ads have to play through to reach the song, so keep them going too.
  keepPlaying(v)
  // The ad marker can lag the ad itself, so wait a moment before treating the
  // <video> as the song: no start seek and no progress until then.
  settledTicks = ad ? 0 : settledTicks + 1
  if (settledTicks < SETTLE_TICKS) return

  if (!startApplied && v.readyState >= HTMLMediaElement.HAVE_METADATA) {
    startApplied = true
    if (state.startMs > 1000) v.currentTime = state.startMs / 1000
  }
  if (state.seek.id !== seekApplied && v.readyState >= HTMLMediaElement.HAVE_METADATA) {
    seekApplied = state.seek.id
    v.currentTime = state.seek.positionMs / 1000
  }

  const positionMs = Math.round(v.currentTime * 1000)
  if (positionMs > lastContentMs || !v.paused) waitingMs = 0
  else if (state.playing && (waitingMs += TICK_MS) >= START_TIMEOUT_MS) {
    waitingMs = 0
    report({ type: 'error', message: 'YouTube Music did not start playing' })
  }
  lastContentMs = positionMs
  const now = Date.now()
  if (now - lastProgressAt >= PROGRESS_MS) {
    lastProgressAt = now
    report({ type: 'progress', positionMs, playing: !v.paused })
  }
}

function keepPlaying(v: HTMLVideoElement): void {
  if (!state) return
  if (!state.playing) {
    if (!v.paused) v.pause()
    return
  }
  // Covers autoplay hiccups and YTM's "still watching?" pause.
  if (v.paused && !v.ended && Date.now() - lastPlayAttempt > 1000) {
    lastPlayAttempt = Date.now()
    void v.play().catch(() => {})
  }
}

function applyVolume(v: HTMLVideoElement): void {
  if (state && Math.abs(v.volume - state.volume) > 0.005) v.volume = state.volume
}

async function applyOutput(v: HTMLVideoElement): Promise<void> {
  const label = state?.outputLabel ?? null
  if (sink && sink.element === v && sink.label === label) return
  sink = { element: v, label }
  let deviceId = ''
  if (label) {
    const devices = await navigator.mediaDevices.enumerateDevices()
    deviceId = devices.find((d) => d.kind === 'audiooutput' && d.label === label)?.deviceId ?? ''
  }
  try {
    await v.setSinkId(deviceId)
  } catch {
    // Stay on whatever device it was on; this retries when the device or element changes.
  }
}
