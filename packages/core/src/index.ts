import { openDatabase, type Db } from './db'
import { EventBus } from './events'
import { HealthService } from './services/health'
import { LibraryService } from './services/library'
import { PlayerService } from './services/player'
import { QueueService } from './services/queue'
import { SettingsService } from './services/settings'
import { TokenService } from './services/tokens'

export * from './errors'
export * from './events'
export * from './schemas'
export { openDatabase, type Db } from './db'
export { toFtsQuery, LibraryService } from './services/library'
export { HealthService } from './services/health'
export { PlayerService, type PlayerCommand, type PlayerReport } from './services/player'
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
  close(): void
}

/** Wires up the domain layer. Both the IPC adapter and the HTTP API sit on top of this. */
export function createCore(options: { dbPath: string }): Core {
  const db = openDatabase(options.dbPath)
  const events = new EventBus()
  const settings = new SettingsService(db, events)
  const library = new LibraryService(db, events)
  const queue = new QueueService(db, library, settings, events)
  const health = new HealthService(events)
  const player = new PlayerService(queue, library, health, events)
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
    close: () => db.close(),
  }
}
