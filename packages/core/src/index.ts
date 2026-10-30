import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getKv, openDatabase, setKv, type Db } from './db'
import { EventBus } from './events'
import { HealthService } from './services/health'
import { LibraryService } from './services/library'
import {
  parseAccountId,
  YtmProvider,
  type YtmCatalog,
  type YtmProviderOptions,
} from './providers/ytm'
import type { PageRuntime } from './providers/po-token'
import { YtmStreamer } from './providers/ytm-stream'
import { TrackCache } from './stream/track-cache'
import { CatalogService } from './services/catalog'
import { LinkResolver } from './resolve/resolver'
import { AnalysisService } from './services/analysis'
import { AutoplayService } from './services/autoplay'
import { PlayerService } from './services/player'
import { LibraryScanner, type ScannerOptions } from './services/scanner'
import { QueueService } from './services/queue'
import { OverlayService } from './services/overlays'
import { SettingsService } from './services/settings'
import { TokenService } from './services/tokens'

export * from './errors'
export * from './events'
export * from './schemas'
export * from './overlay'
export { openDatabase, type Db } from './db'
export {
  normalizeArtist,
  normalizeTitle,
  sameRecording,
  songTitle,
  type SongIdentity,
} from './library/match'
export {
  toFtsQuery,
  LibraryService,
  type LocalFile,
  type RecordingUpdate,
} from './services/library'
export { LibraryScanner, type ScannerOptions } from './services/scanner'
export { CatalogService, parseYtmRef, type SearchScope } from './services/catalog'
export { LinkResolver } from './resolve/resolver'
export { AutoplayService } from './services/autoplay'
export {
  ANALYSIS_VERSION,
  AnalysisService,
  AnalyzerUnavailable,
  type AudioAnalyzer,
} from './services/analysis'
export * from './autoplay/rank'
export { parseCollectionLink, parseLink, type TrackLink } from './resolve/links'
export { jaroWinkler, scoreMatch, CONFIDENT, PLAUSIBLE } from './resolve/score'
export {
  activeAccountName,
  MAX_COLLECTION_SONGS,
  parseAccountId,
  parseCollectionRef,
  summariseArtists,
  toYtmAccount,
  YtmProvider,
  type YtmIdentity,
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
export { readLocalFile } from './stream/local-file'
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
export { OverlayService } from './services/overlays'
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
  overlays: OverlayService
  health: HealthService
  scanner: LibraryScanner
  ytm: YtmCatalog
  catalog: CatalogService
  autoplay: AutoplayService
  /** Background audio analysis; the app attaches the analyzer. */
  analysis: AnalysisService
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
  /**
   * Randomness and clock for autoplay's picks; tests pass fixed ones. `false`
   * stops it reacting to queue changes by itself (tests of other things).
   */
  autoplay?: false | { random?: () => number; now?: () => number }
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
  // The YouTube channel to use (a brand channel or the account's own), kept between runs.
  const ytmAccount = {
    get: () => getKv(db, 'ytm_account') || null,
    set: (id: string | null) => setKv(db, 'ytm_account', id ?? ''),
  }
  const stream = options.stream
  const streamer = stream
    ? new YtmStreamer({
        runtime: stream.runtime,
        identity: () => parseAccountId(ytmAccount.get()),
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
    ? new YtmProvider(events, { ...ytmOptions, account: ytmAccount, playback: streamer !== null })
    : (options.ytm as YtmCatalog)
  // The direct engine plays as the chosen channel too.
  let ytmAccountId = ytm.status().accountId
  events.subscribe((e) => {
    if (e.type !== 'ytm.changed' || e.data.accountId === ytmAccountId) return
    ytmAccountId = e.data.accountId
    streamer?.refresh()
  })
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
  const player = new PlayerService(queue, library, settings, health, ytm, tracks, events, {
    volume: {
      get: () => {
        const saved = Number(getKv(db, 'player_volume'))
        return getKv(db, 'player_volume') !== undefined && saved >= 0 && saved <= 1 ? saved : null
      },
      set: (volume) => setKv(db, 'player_volume', String(volume)),
    },
  })
  const analysis = new AnalysisService(db, library, settings, tracks, events)
  const autoplay = new AutoplayService(library, queue, settings, ytm, analysis, events, {
    watch: options.autoplay !== false,
    // On repeat the queue goes round; adding songs would only grow the loop.
    repeating: () => player.get().repeat !== 'off',
    ...options.autoplay,
  })
  const tokens = new TokenService(db)
  const overlays = new OverlayService(db, events)
  return {
    db,
    events,
    library,
    queue,
    player,
    settings,
    tokens,
    overlays,
    health,
    scanner,
    ytm,
    catalog,
    autoplay,
    analysis,
    streamer,
    tracks,
    artworkDir: scannerOptions.artworkDir,
    close: async () => {
      autoplay.stop()
      await scanner.stop()
      await tracks?.close()
      db.close()
    },
  }
}
