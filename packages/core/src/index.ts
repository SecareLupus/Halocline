import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { openDatabase, type Db } from './db'
import { EventBus } from './events'
import { HealthService } from './services/health'
import { LibraryService } from './services/library'
import { PlayerService } from './services/player'
import { LibraryScanner, type ScannerOptions } from './services/scanner'
import { QueueService } from './services/queue'
import { SettingsService } from './services/settings'
import { TokenService } from './services/tokens'

export * from './errors'
export * from './events'
export * from './schemas'
export { openDatabase, type Db } from './db'
export {
  toFtsQuery,
  LibraryService,
  type LocalFile,
  type RecordingUpdate,
} from './services/library'
export { LibraryScanner, type ScannerOptions } from './services/scanner'
export type { ScanInput, ScanMessage, ScanRunner, ScannedFile } from './scan/types'
export { HealthService } from './services/health'
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
  /** Stops the scanner and watchers, then closes the database. */
  close(): Promise<void>
}

/** Wires up the domain layer. Both the IPC adapter and the HTTP API sit on top of this. */
export function createCore(options: { dbPath: string; scanner?: Partial<ScannerOptions> }): Core {
  const db = openDatabase(options.dbPath)
  const events = new EventBus()
  const settings = new SettingsService(db, events)
  const library = new LibraryService(db, events)
  const queue = new QueueService(db, library, settings, events)
  const health = new HealthService(events)
  const player = new PlayerService(queue, library, settings, health, events)
  const tokens = new TokenService(db)
  const defaultArtworkDir =
    options.dbPath === ':memory:'
      ? join(tmpdir(), 'halocline-artwork')
      : join(dirname(options.dbPath), 'artwork')
  const scanner = new LibraryScanner(library, settings, events, {
    artworkDir: defaultArtworkDir,
    ...options.scanner,
  })
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
    close: async () => {
      await scanner.stop()
      db.close()
    },
  }
}
