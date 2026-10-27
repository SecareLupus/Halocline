import type { PlayerCommand, PlayerReport } from '@halocline/core'
import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { YTM_ENGINE_IPC, type YtmEngineState } from '../shared/ytm-engine'
import { YTM_PARTITION } from './ytm-auth'

const preload = join(import.meta.dirname, '../preload/ytm-engine.cjs')
const WATCH_URL = 'https://music.youtube.com/watch?v='

/**
 * The fallback engine (PLAN §4): music.youtube.com in a hidden window on the
 * signed-in YTM session, so Premium applies. Main turns player commands into a
 * target state and the window's preload drives the page's own player towards
 * it, reporting progress, end of track and ad state back.
 */
export class YtmFallbackEngine {
  private window: BrowserWindow | null = null
  private state: YtmEngineState = {
    loadId: 0,
    videoId: null,
    startMs: 0,
    playing: false,
    volume: 0.8,
    seek: { id: 0, positionMs: 0 },
    outputLabel: null,
  }

  constructor(
    /** Maps a `track://` source ID to its YouTube video ID. */
    private readonly videoIdOf: (sourceId: string) => string | undefined,
    private readonly report: (report: PlayerReport) => void,
  ) {
    ipcMain.handle(YTM_ENGINE_IPC.hello, (event) => {
      if (event.sender !== this.window?.webContents) throw new Error('Unknown sender')
      return this.state
    })
    ipcMain.on(YTM_ENGINE_IPC.report, (event, report: PlayerReport) => {
      if (event.sender === this.window?.webContents) this.report(report)
    })
  }

  send(command: PlayerCommand): void {
    switch (command.type) {
      case 'load': {
        const videoId = this.videoIdOf(command.nowPlaying.sourceId)
        if (!videoId) {
          this.report({ type: 'error', message: 'Not a YouTube Music track' })
          return
        }
        this.update({
          loadId: this.state.loadId + 1,
          videoId,
          startMs: command.startMs,
          playing: command.play,
        })
        this.open(videoId)
        break
      }
      case 'play':
      case 'pause':
        this.update({ playing: command.type === 'play' })
        break
      case 'seek':
        this.update({ seek: { id: this.state.seek.id + 1, positionMs: command.positionMs } })
        break
      case 'volume':
        this.update({ volume: command.volume })
        break
      case 'stop':
        this.update({ videoId: null, playing: false })
        break
      case 'cue':
      case 'configure':
        break
    }
  }

  /** The output device, by label, since device IDs differ between origins. */
  setOutput(label: string | null): void {
    if (label !== this.state.outputLabel) this.update({ outputLabel: label })
  }

  /** Whether `contents` is this engine's page (for permission checks). */
  owns(contents: Electron.WebContents): boolean {
    return contents === this.window?.webContents
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private update(changes: Partial<YtmEngineState>): void {
    this.state = { ...this.state, ...changes }
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(YTM_ENGINE_IPC.state, this.state)
    }
  }

  private open(videoId: string): void {
    const window = this.page()
    window.loadURL(`${WATCH_URL}${encodeURIComponent(videoId)}`).catch((err: unknown) => {
      // A newer load replacing this one aborts it; that's not a failure.
      if (this.state.videoId !== videoId || this.window !== window) return
      this.report({ type: 'error', message: `YouTube Music didn't load: ${String(err)}` })
    })
  }

  private page(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: {
        partition: YTM_PARTITION,
        preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // Stay on YouTube Music; YTM's own in-app navigation doesn't fire this.
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('https://music.youtube.com/')) event.preventDefault()
    })
    window.webContents.on('render-process-gone', () => {
      this.window = null
      if (this.state.videoId)
        this.report({ type: 'error', message: 'YouTube Music window crashed' })
    })
    this.window = window
    return window
  }
}
