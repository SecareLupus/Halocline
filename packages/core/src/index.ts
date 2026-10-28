import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { openDatabase, type Db } from './db'
import { EventBus } from './events'
import { HealthService } from './services/health'
import { LibraryService } from './services/library'
import { YtmProvider, type YtmCatalog, type YtmProviderOptions } from './providers/ytm'
import type { PageRuntime } from './providers/po-token'
import { YtmStreamer } from './providers/ytm-stream'
import { TrackCache } from './stream/track-cache'
import { CatalogService } from './services/catalog'
import { LinkResolver } from './resolve/resolver'
import { PlayerService } from './services/player'
import { LibraryScanner, type ScannerOptions } from './services/scanner'
import { QueueService } from './services/queue'
import { SettingsService } from './services/settings'
import { TokenService } from './services/tokens'

export * from './errors'
export * from './events'
export * from './schemas'
export { openDatabase, type Db } from './db'
export { normalizeArtist, normalizeTitle, sameRecording, type SongIdentity } from './library/match'
export {
  toFtsQuery,
  LibraryService,
  type LocalFile,
  type RecordingUpdate,
} from './services/library'
export { LibraryScanner, type ScannerOptions } from './services/scanner'
export { CatalogService, parseYtmRef, type SearchScope } from './services/catalog'
export { LinkResolver } from './resolve/resolver'
export { parseLink, type TrackLink } from './resolve/links'
export { jaroWinkler, scoreMatch, CONFIDENT, PLAUSIBLE } from './resolve/score'
export {
  YtmProvider,
  upscaleArtwork,
  type YtmCatalog,
  type YtmProviderOptions,
} from './providers/ytm'
export { PoTokenMinter, runInPage, type PageRuntime } from './providers/po-token'
export {
  YtmStreamer,
  StreamError,
  pickAudio,
  type AudioSource,
  type AudioStream,
  type StreamStep,
  type YtmStreamerOptions,
} from './providers/ytm-stream'
export { TrackCache, parseRange, type TrackStore } from './stream/track-cache'
export type { ScanInput, ScanMessage, ScanRunner, ScannedFile } from './scan/types'
export { HealthService } from './services/health'
export { EngineRouter, type EngineName } from './services/engine-router'
export {
  PlayerService,
  type PlayerCommand,
  type PlayerReport,
  type TrackLoad,
} from './services/player'
export * from './playback'
export { QueueService, type AddToQueue } from './services/queue'
export { SettingsService } from './services/settings'
export { TokenService } from './services/tokens'
export { CircuitBreaker } from './stream/circuit-breaker'
export { chooseSource, type SourceChoice } from './stream/source-choice'

export interface Core {
  db: Db
  events: EventBus
  library: LibraryService
  queue: QueueService
  player: PlayerService
  settings: SettingsService
  tokens: TokenService
  health: HealthService
  scanner: LibraryScanner
  ytm: YtmCatalog
  catalog: CatalogService
  /** The direct YTM engine and its track cache, when a page runtime was given. */
  streamer: YtmStreamer | null
  tracks: TrackCache | null
  /** Where the scanner keeps extracted cover art, named by content hash. */
  artworkDir: string
  /** Stops the scanner and watchers, then closes the database. */
  close(): Promise<void>
}

const DEFAULT_CACHE_BYTES = 1024 ** 3

/** Wires up the domain layer. Both the IPC adapter and the HTTP API sit on top of this. */
export function createCore(options: {
  dbPath: string
  scanner?: Partial<ScannerOptions>
  /** A YTM catalog to use instead of the real provider (tests), or options for it. */
  ytm?: YtmCatalog | YtmProviderOptions
  /** For the link resolver's metadata lookups; tests pass a fake. */
  fetch?: typeof globalThis.fetch
  /** Enables direct YTM playback (PLAN §4). The app shell supplies the page runtime. */
  stream?: {
    runtime: PageRuntime
    /** Track cache directory. */
    cacheDir: string
    maxCacheBytes?: number
    /** Where youtubei.js keeps the parsed player script. */
    playerCacheDir?: string
  }
}): Core {
  const db = openDatabase(options.dbPath)
  const events = new EventBus()
  const settings = new SettingsService(db, events)
  const library = new LibraryService(db, events)
  const queue = new QueueService(db, library, settings, events)
  const health = new HealthService(events)
  const ytmOptions = options.ytm && 'searchSongs' in options.ytm ? null : (options.ytm ?? {})
  const stream = options.stream
  const streamer = stream
    ? new YtmStreamer({
        runtime: stream.runtime,
        ...(ytmOptions?.cookie && { cookie: ytmOptions.cookie }),
        ...(stream.playerCacheDir && { cacheDir: stream.playerCacheDir }),
      })
    : null
  const tracks =
    streamer && stream
      ? new TrackCache(streamer, {
          dir: stream.cacheDir,
          maxBytes: stream.maxCacheBytes ?? DEFAULT_CACHE_BYTES,
        })
      : null
  const ytm = ytmOptions
    ? new YtmProvider(events, { ...ytmOptions, playback: streamer !== null })
    : (options.ytm as YtmCatalog)
  const defaultArtworkDir =
    options.dbPath === ':memory:'
      ? join(tmpdir(), 'halocline-artwork')
      : join(dirname(options.dbPath), 'artwork')
  const scannerOptions = { artworkDir: defaultArtworkDir, ...options.scanner }
  const scanner = new LibraryScanner(library, settings, events, scannerOptions)
  const catalog = new CatalogService(
    library,
    ytm,
    new LinkResolver(db, library, ytm, options.fetch),
    queue,
    (paths) => scanner.scanPaths(paths),
  )
  const player = new PlayerService(queue, library, settings, health, ytm, tracks, events)
  const tokens = new TokenService(db)
  return {
    db,
    events,
    library,
    queue,
    player,
    settings,
    tokens,
    health,
    scanner,
    ytm,
    catalog,
    streamer,
    tracks,
    artworkDir: scannerOptions.artworkDir,
    close: async () => {
      await scanner.stop()
      await tracks?.close()
      db.close()
    },
  }
}
