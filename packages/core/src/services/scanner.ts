import { resolve } from 'node:path'
import type { EventBus } from '../events'
import { isUnder, runScan } from '../scan/run'
import type { ScanInput, ScanMessage, ScanRunner } from '../scan/types'
import { watchFolder } from '../scan/watcher'
import type { ScanStatus } from '../schemas'
import type { LibraryService } from './library'
import type { SettingsService } from './settings'

export interface ScannerOptions {
  /** Where embedded cover art is extracted to. */
  artworkDir: string
  /** Runs scan jobs; the app passes a worker-thread runner. Defaults to in-process. */
  run?: ScanRunner
  /** Watch library folders for changes. */
  watch?: boolean
  /** How long to gather file-system events before rescanning them. */
  debounceMs?: number
}

const inProcess: ScanRunner = (input, onMessage, signal) => runScan(input, onMessage, signal)

const idle = (): ScanStatus => ({
  state: 'idle',
  phase: null,
  found: 0,
  processed: 0,
  added: 0,
  updated: 0,
  missing: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
})

/**
 * Keeps the library in step with the library folders (PLAN §3): a scan on
 * start, incremental rescans (size + mtime) on demand, and live updates from a
 * folder watcher. Scan jobs do the file work off-thread; this class applies
 * their results to the database and reports progress as `scan.changed`.
 */
export class LibraryScanner {
  private current: ScanStatus = idle()
  private queue: Promise<void> = Promise.resolve()
  private queuedWalk: { full: boolean; done: Promise<void> } | null = null
  private pendingPaths = new Set<string>()
  private debounce: ReturnType<typeof setTimeout> | null = null
  private readonly watchers = new Map<string, Promise<(() => Promise<void>) | null>>()
  private readonly abort = new AbortController()
  private unsubscribe: (() => void) | null = null
  private roots: string[] = []
  private readonly run: ScanRunner

  constructor(
    private readonly library: LibraryService,
    private readonly settings: SettingsService,
    private readonly events: EventBus,
    private readonly options: ScannerOptions,
  ) {
    this.run = options.run ?? inProcess
  }

  status(): ScanStatus {
    return this.current
  }

  /** Scans the library folders now, and keeps watching them as settings change. */
  async start(): Promise<void> {
    this.unsubscribe = this.events.subscribe((e) => {
      if (e.type === 'settings.changed') void this.syncFolders()
    })
    await this.syncFolders(true)
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.abort.abort()
    if (this.debounce) clearTimeout(this.debounce)
    const watchers = [...this.watchers.values()]
    this.watchers.clear()
    await Promise.all(watchers.map(async (w) => (await w)?.()))
    await this.queue.catch(() => {})
  }

  /**
   * Walks every library folder. Unchanged files are skipped unless `full`.
   * Requests made while a walk is waiting to start share that walk.
   */
  scan(options: { full?: boolean } = {}): Promise<void> {
    const full = options.full ?? false
    if (this.queuedWalk && (this.queuedWalk.full || !full)) return this.queuedWalk.done
    const done = this.enqueue(() => {
      this.queuedWalk = null
      return this.job({ roots: this.roots, full })
    })
    this.queuedWalk = { full, done }
    return done
  }

  /** Rescans specific files or folders, e.g. after file-system events. */
  scanPaths(paths: string[]): Promise<void> {
    const inLibrary = paths
      .map((p) => resolve(p))
      .filter((p) => this.roots.some((r) => isUnder(r, p)))
    if (!inLibrary.length) return Promise.resolve()
    return this.enqueue(() => this.job({ roots: this.roots, paths: inLibrary }))
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const done = this.queue.then(task)
    this.queue = done.catch(() => {})
    return done
  }

  private async syncFolders(initial = false): Promise<void> {
    const roots = [...new Set(this.settings.get().library.folders.map((f) => resolve(f)))]
    const added = roots.filter((r) => !this.roots.includes(r))
    const removed = this.roots.filter((r) => !roots.includes(r))
    if (!initial && !added.length && !removed.length) return
    this.roots = roots

    for (const root of removed) {
      const stop = this.watchers.get(root)
      this.watchers.delete(root)
      void stop?.then((s) => s?.())
    }
    if (this.options.watch ?? true) {
      for (const root of added) this.watchers.set(root, this.watch(root))
    }

    // Files in folders that are no longer part of the library become unavailable.
    const outside = Object.keys(this.library.localFiles()).filter(
      (path) => !roots.some((r) => isUnder(r, path)),
    )
    if (outside.length) {
      this.library.notifyChanged(this.library.markLocalMissing(outside))
    }
    if (initial || added.length) await this.scan()
  }

  private async watch(root: string): Promise<(() => Promise<void>) | null> {
    try {
      return await watchFolder(
        root,
        (paths) => this.onFileEvents(paths),
        (err) => this.setStatus({ lastError: `Watching ${root}: ${err.message}` }),
      )
    } catch (err) {
      this.setStatus({ lastError: `Cannot watch ${root}: ${(err as Error).message}` })
      return null
    }
  }

  private onFileEvents(paths: string[]): void {
    for (const p of paths) this.pendingPaths.add(p)
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      const batch = [...this.pendingPaths]
      this.pendingPaths.clear()
      void this.scanPaths(batch)
    }, this.options.debounceMs ?? 1500)
  }

  private async job(input: Omit<ScanInput, 'known' | 'artworkDir'>): Promise<void> {
    if (this.abort.signal.aborted) return
    this.setStatus({ ...idle(), state: 'scanning', phase: 'walking', startedAt: Date.now() })
    try {
      await this.run(
        { ...input, known: this.library.localFiles(), artworkDir: this.options.artworkDir },
        (message) => this.handle(message),
        this.abort.signal,
      )
    } catch (err) {
      this.setStatus({ lastError: err instanceof Error ? err.message : String(err) })
    } finally {
      this.setStatus({ state: 'idle', phase: null, finishedAt: Date.now() })
    }
  }

  private handle(message: ScanMessage): void {
    switch (message.type) {
      case 'progress':
        this.setStatus({ phase: message.phase, found: message.found, processed: message.processed })
        return
      case 'files': {
        const counts = { added: 0, updated: 0, failed: 0 }
        const ids = this.library.transaction(() =>
          message.files.map((file) => {
            if (file.error) counts.failed++
            const { recordingId, outcome } = this.library.saveLocalFile(file)
            counts[outcome === 'added' ? 'added' : 'updated']++
            return recordingId
          }),
        )
        this.library.notifyChanged(ids)
        this.setStatus({
          added: this.current.added + counts.added,
          updated: this.current.updated + counts.updated,
          failed: this.current.failed + counts.failed,
        })
        return
      }
      case 'missing': {
        const ids = this.library.transaction(() => this.library.markLocalMissing(message.paths))
        this.library.notifyChanged(ids)
        this.setStatus({ missing: this.current.missing + ids.length })
        return
      }
      case 'error':
        this.setStatus({ lastError: message.message })
        return
    }
  }

  private setStatus(changes: Partial<ScanStatus>): void {
    this.current = { ...this.current, ...changes }
    this.events.publish({ type: 'scan.changed', data: this.current })
  }
}
