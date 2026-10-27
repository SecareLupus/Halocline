// The contract between the UI renderer and the main process. Arguments are
// validated in main against the same zod schemas the HTTP API uses.
import type {
  ApiToken,
  Health,
  OutputState,
  PlayerCommand,
  PlayerPatch,
  PlayerReport,
  PlayerState,
  ProblemType,
  Queue,
  QueueItem,
  QueuePosition,
  Recording,
  ScanStatus,
  Scope,
  Settings,
  SettingsPatch,
  StampedEvent,
} from '@halocline/core'

export interface IpcHandlers {
  'library.search': (args: { q: string }) => Recording[]
  'library.addFolder': () => Settings
  'library.removeFolder': (args: { folder: string }) => Settings
  'library.rescan': (args: { full?: boolean }) => void
  'scan.status': () => ScanStatus
  'queue.list': () => Queue
  'queue.add': (args: { recordingId: string; position?: QueuePosition }) => QueueItem
  'queue.move': (args: { id: string; position: QueuePosition }) => QueueItem
  'queue.remove': (args: { id: string }) => void
  'player.get': () => PlayerState
  'player.output': () => OutputState
  'player.patch': (args: PlayerPatch) => PlayerState
  'player.next': () => PlayerState
  'player.previous': () => PlayerState
  'health.get': () => Health
  'settings.get': () => Settings
  'settings.patch': (args: SettingsPatch) => Settings
  'tokens.list': () => ApiToken[]
  'tokens.create': (args: { name: string; scopes: Scope[] }) => { secret: string; token: ApiToken }
  'tokens.revoke': (args: { id: string }) => void
  'api.url': () => string | null
}

export type IpcChannel = keyof IpcHandlers

export type IpcResult<T> =
  { ok: true; value: T } | { ok: false; error: { type: ProblemType | 'internal'; message: string } }

/** Exposed on `window.halocline` by the preload script. */
export interface HaloclineBridge {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: Parameters<IpcHandlers[C]>
  ): Promise<IpcResult<ReturnType<IpcHandlers[C]>>>
  onEvent(listener: (event: StampedEvent) => void): () => void
  /** Used only by the player renderer. */
  player: {
    onCommand(listener: (command: PlayerCommand) => void): () => void
    report(report: PlayerReport): void
  }
}

export const IPC = {
  invoke: 'halocline:invoke',
  event: 'halocline:event',
  playerCommand: 'halocline:player-command',
  playerReport: 'halocline:player-report',
} as const
