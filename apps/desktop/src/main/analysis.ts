import {
  AnalyzerUnavailable,
  AudioFeatures,
  type AudioAnalyzer,
  type Core,
  type Source,
} from '@halocline/core'
import { BrowserWindow, ipcMain, net } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC, type AnalysisReport } from '../shared/ipc'
import { createAnalysisWindow } from './windows'

/**
 * The CLAP audio encoder (laion/larger_clap_music_and_speech, Apache-2.0), as
 * converted to ONNX and quantized by Xenova. Pinned to one revision and checked
 * by hash, so what runs is what was tested.
 */
const MODEL = {
  url: 'https://huggingface.co/Xenova/larger_clap_music_and_speech/resolve/e9fd5ac1dbf3280936a7fc3ec8a020453ff184db/onnx/audio_model_quantized.onnx',
  file: 'clap-music-speech-e9fd5ac1-q8.onnx',
  bytes: 78_155_433,
  sha256: '021dd4fb962b4ed20cc3a6730b09e0ccf9f9c49931047032118a3b64828513a6',
}

/** A track taking longer than this is given up on (a 20-minute track takes well under one). */
const JOB_TIMEOUT_MS = 3 * 60_000
/** The window, with its model and WASM heaps, is closed after this long without work. */
const IDLE_CLOSE_MS = 60_000

interface Job {
  source: Source
  resolve: (features: AudioFeatures) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Runs audio analysis for the core (PLAN §7) in a hidden window: it decodes with
 * Chromium, measures with essentia.js and embeds with ONNX Runtime. The model is
 * downloaded the first time something needs analyzing.
 */
export class AnalysisHost implements AudioAnalyzer {
  private window: BrowserWindow | null = null
  private ready: Promise<BrowserWindow> | null = null
  private download: Promise<string> | null = null
  private readonly jobs = new Map<number, Job>()
  private nextId = 1
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly core: Core,
    private readonly modelDir: string,
  ) {}

  async start(): Promise<void> {
    ipcMain.on(IPC.analysisReport, (event, report: AnalysisReport) => {
      if (event.sender !== this.window?.webContents) return
      const job = this.jobs.get(report.jobId)
      if (!job) return
      this.jobs.delete(report.jobId)
      clearTimeout(job.timer)
      if (!report.ok) return job.reject(new Error(report.error))
      const parsed = AudioFeatures.safeParse(report.features)
      if (parsed.success) job.resolve(parsed.data)
      else job.reject(new Error(`Unexpected analysis result: ${parsed.error.message}`))
    })
    // Bytes over IPC rather than a track:// fetch, which CORS blocks from a file:// page.
    ipcMain.handle(IPC.analysisAudio, async (event, jobId: number) => {
      const job = this.jobs.get(jobId)
      if (event.sender !== this.window?.webContents || !job) throw new Error('No such job')
      return this.audio(job.source)
    })
    ipcMain.handle(IPC.analysisModel, async (event) => {
      if (event.sender !== this.window?.webContents) throw new Error('Not the analysis window')
      return readFile(await this.model())
    })
    const have = await this.verified(this.modelPath())
    this.core.analysis.setModel({
      state: have ? 'ready' : 'missing',
      progress: have ? 1 : 0,
      error: null,
    })
    this.core.analysis.attach(this)
  }

  /** Whether `contents` is the analysis window's, which gets no app events. */
  owns(window: BrowserWindow): boolean {
    return window === this.window
  }

  async analyze(source: Source): Promise<AudioFeatures> {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    try {
      await this.model()
    } catch (err) {
      throw new AnalyzerUnavailable(`The analysis model isn't available: ${(err as Error).message}`)
    }
    const window = await this.open()
    const jobId = this.nextId++
    return new Promise<AudioFeatures>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.jobs.delete(jobId)
        reject(new Error('Analysis took too long'))
        this.close() // A stuck page is replaced with a fresh one.
      }, JOB_TIMEOUT_MS)
      this.jobs.set(jobId, { source, resolve, reject, timer })
      window.webContents.send(IPC.analysisJob, { jobId })
    })
  }

  idle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS)
  }

  destroy(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.close()
  }

  private open(): Promise<BrowserWindow> {
    this.ready ??= new Promise<BrowserWindow>((resolve, reject) => {
      const window = createAnalysisWindow()
      this.window = window
      window.webContents.once('did-finish-load', () => resolve(window))
      window.webContents.once('did-fail-load', (_e, _code, description) =>
        reject(new AnalyzerUnavailable(`The analysis page didn't load: ${description}`)),
      )
      // Most likely the track being decoded (out of memory): that job fails, the rest go on.
      window.webContents.on('render-process-gone', (_e, details) => {
        this.failAll(new Error(`The analysis window stopped (${details.reason})`))
        this.close()
      })
    }).catch((err: unknown) => {
      this.close()
      throw err
    })
    return this.ready
  }

  private close(): void {
    this.failAll(new AnalyzerUnavailable('The analysis window was closed'))
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
    this.ready = null
  }

  private failAll(err: Error): void {
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer)
      job.reject(err)
    }
    this.jobs.clear()
  }

  private async audio(source: Source): Promise<Uint8Array> {
    if (source.kind === 'local') return readFile(source.locator)
    if (!this.core.tracks) throw new Error('No track cache')
    const res = await this.core.tracks.read(source.locator, null)
    if (!res.ok) throw new Error(`The cached track couldn't be read (HTTP ${res.status})`)
    return new Uint8Array(await res.arrayBuffer())
  }

  private modelPath(): string {
    return join(this.modelDir, MODEL.file)
  }

  /** The model file, downloading it first if needed. */
  private model(): Promise<string> {
    this.download ??= this.fetchModel().catch((err: unknown) => {
      this.download = null
      const message = err instanceof Error ? err.message : String(err)
      this.core.analysis.setModel({ state: 'failed', progress: 0, error: message })
      throw err
    })
    return this.download
  }

  private async fetchModel(): Promise<string> {
    const path = this.modelPath()
    if (await this.verified(path)) return path
    await mkdir(this.modelDir, { recursive: true })
    const part = `${path}.part`
    const report = (progress: number) =>
      this.core.analysis.setModel({ state: 'downloading', progress, error: null })
    report(0)
    const res = await net.fetch(MODEL.url)
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
    const hash = createHash('sha256')
    const out = createWriteStream(part)
    let received = 0
    let reported = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        received += value.length
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        if (received - reported > MODEL.bytes / 100) {
          reported = received
          report(Math.min(1, received / MODEL.bytes))
        }
      }
      await new Promise<void>((resolve, reject) =>
        out.end((err?: Error | null) => (err ? reject(err) : resolve())),
      )
    } catch (err) {
      out.destroy()
      await rm(part, { force: true })
      throw err
    }
    if (hash.digest('hex') !== MODEL.sha256) {
      await rm(part, { force: true })
      throw new Error('The downloaded model failed its checksum')
    }
    await rename(part, path)
    this.core.analysis.setModel({ state: 'ready', progress: 1, error: null })
    return path
  }

  /** A complete download; the hash was checked when it was saved. */
  private async verified(path: string): Promise<boolean> {
    const info = await stat(path).catch(() => null)
    return info?.size === MODEL.bytes
  }
}
