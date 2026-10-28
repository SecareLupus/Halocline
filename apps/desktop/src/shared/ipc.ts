// The contract between the UI renderer and the main process. Arguments are
// validated in main against the same zod schemas the HTTP API uses.
import type {
  ApiToken,
  BulkResult,
  Health,
  OdesliStatus,
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
  RecordingPatch,
  Resolution,
  ScanStatus,
  SearchResult,
  Scope,
  Settings,
  SettingsPatch,
  StampedEvent,
  YtmSong,
  YtmStatus,
} from '@halocline/core'

/** The OBS overlay's address and the source size its layout is designed for (PLAN §8). */
export interface OverlayInfo {
  url: string
  width: number
  height: number
}

export interface IpcHandlers {
  'library.search': (args: { q: string }) => Recording[]
  /** Library first, then YouTube Music songs. */
  search: (args: { q: string }) => SearchResult[]
  'queue.addYtm': (args: { song: YtmSong; position?: QueuePosition }) => QueueItem
  /** What a pasted link (or query) means, without enqueueing (PLAN §5). */
  resolve: (args: { input: string }) => Resolution
  /** Enqueues by resolving `input`: a candidate's input, a link, a ref or a recording ID. */
  'queue.addInput': (args: { input: string; position?: QueuePosition }) => QueueItem
  /** The song.link fallback for links nothing else matches; off without an API key. */
  'odesli.status': () => OdesliStatus
  /** Sets the song.link API key, or removes it with `null`. */
  'odesli.setKey': (args: { key: string | null }) => OdesliStatus
  'ytm.status': () => YtmStatus
  'ytm.signIn': () => void
  'ytm.signOut': () => void
  'library.edit': (args: { id: string; changes: RecordingPatch }) => Recording
  'library.editMany': (args: { ids: string[]; changes: RecordingPatch }) => BulkResult
  'library.addFolder': () => Settings
  'library.removeFolder': (args: { folder: string }) => Settings
  'library.rescan': (args: { full?: boolean }) => void
  'scan.status': () => ScanStatus
  'queue.list': () => Queue
  'queue.add': (args: { recordingId: string; position?: QueuePosition }) => QueueItem
  'queue.move': (args: { id: string; position: QueuePosition }) => QueueItem
  'queue.remove': (args: { id: string }) => void
  /** Pins a queue item to one source, or back to automatic with `null` (PLAN §3). */
  'queue.pin': (args: { id: string; sourceId: string | null }) => QueueItem
  /** Saves a YouTube Music song to the library. */
  'library.saveYtm': (args: { song: YtmSong }) => Recording
  'player.get': () => PlayerState
  'player.output': () => OutputState
  'player.patch': (args: PlayerPatch) => PlayerState
  'player.next': () => PlayerState
  'player.previous': () => PlayerState
  'health.get': () => Health
  'settings.get': () => Settings
  'settings.patch': (args: SettingsPatch) => Settings
  'tokens.list': () => ApiToken[]
  'tokens.create': (args: { name: string; scopes: Scope[]; rateLimitPerMin?: number }) => {
    secret: string
    token: ApiToken
  }
  'tokens.revoke': (args: { id: string }) => void
  'api.url': () => string | null
  /** Copies the OBS overlay URL to the clipboard, creating its token on first use. */
  'overlay.copy': () => OverlayInfo
  /** Replaces the overlay token; the old URL stops working. Copies the new URL. */
  'overlay.rotate': () => OverlayInfo
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
