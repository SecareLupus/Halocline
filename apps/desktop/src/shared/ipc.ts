// The contract between the UI renderer and the main process. Arguments are
// validated in main against the same zod schemas the HTTP API uses.
import type {
  AnalysisStatus,
  ApiToken,
  AudioFeatures,
  BulkResult,
  Health,
  HistoryPage,
  NewOverlay,
  OutputState,
  Overlay,
  OverlayUpdate,
  PlayerCommand,
  PlayerPatch,
  PlayerReport,
  PlayerState,
  ProblemType,
  Queue,
  QueueItem,
  QueuePosition,
  Recording,
  RecordingDetail,
  RecordingPatch,
  Resolution,
  ScanStatus,
  SearchResult,
  Scope,
  Settings,
  SettingsPatch,
  SplitResult,
  StampedEvent,
  YtmAccount,
  YtmCollection,
  YtmCollectionDetail,
  YtmSong,
  YtmStatus,
} from '@halocline/core'

/** An OBS overlay's address, and the size to give its Browser Source: its canvas (PLAN §8). */
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
  /** A YouTube Music album or playlist with its tracks. */
  'collection.get': (args: { ref: string }) => YtmCollectionDetail
  /** The album or playlist a pasted link names; null for any other input. */
  'collection.match': (args: { input: string }) => YtmCollectionDetail | null
  /** Queues a whole album or playlist, in order. */
  'queue.addCollection': (args: { ref: string; position?: QueuePosition }) => {
    collection: YtmCollection
    items: QueueItem[]
    skipped: number
  }
  /** What a pasted link (or query) means, without enqueueing (PLAN §5). */
  resolve: (args: { input: string }) => Resolution
  /** Enqueues by resolving `input`: a candidate's input, a link, a ref or a recording ID. */
  'queue.addInput': (args: { input: string; position?: QueuePosition }) => QueueItem
  'ytm.status': () => YtmStatus
  /** The channels the signed-in account can use YouTube Music as. */
  'ytm.accounts': () => YtmAccount[]
  /** Uses one of those channels; null goes back to the account's own. */
  'ytm.selectAccount': (args: { id: string | null }) => YtmStatus
  /** Audio analysis progress (PLAN §7). */
  'analysis.status': () => AnalysisStatus
  'ytm.signIn': () => void
  'ytm.signOut': () => void
  'library.edit': (args: { id: string; changes: RecordingPatch }) => Recording
  'library.editMany': (args: { ids: string[]; changes: RecordingPatch }) => BulkResult
  /** Recently played, latest first; `before` pages back. */
  'history.list': (args: { before?: string }) => HistoryPage
  /** Empties the history (play counts stay). */
  'history.clear': () => void
  /** Merges duplicates of the same song into `id` (PLAN §3). */
  'library.merge': (args: { id: string; from: string[] }) => RecordingDetail
  /** Moves sources that aren't this song onto a new recording (PLAN §3). */
  'library.split': (args: { id: string; sourceIds: string[] }) => SplitResult
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
  /**
   * Start radio: clears the queue, queues this song, then fills up to "Keep queued"
   * with songs like it, whether autoplay is on or not.
   */
  'queue.radio': (args: { recordingId: string } | { song: YtmSong } | { input: string }) => Queue
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
  /**
   * Copies an overlay's URL (the default one's without an id) to the clipboard,
   * creating the overlay token on first use.
   */
  'overlay.copy': (args?: { id?: string }) => OverlayInfo
  /** Replaces the overlay token; every old URL stops working. Copies the default one's new URL. */
  'overlay.rotate': () => OverlayInfo
  /** OBS overlays, the default one first (PLAN §8). */
  'overlays.list': () => Overlay[]
  'overlays.get': (args: { id: string }) => Overlay
  /** From Classic unless a document is given. */
  'overlays.create': (args: NewOverlay) => Overlay
  /**
   * Renames an overlay or replaces its document whole. With `revision`, fails
   * with `revision_mismatch` if it has changed since.
   */
  'overlays.update': (args: { id: string; changes: OverlayUpdate; revision?: number }) => Overlay
  /** The default overlay can't be deleted. */
  'overlays.delete': (args: { id: string }) => void
  /** Saves an overlay to a file the user picks; false if they cancel. */
  'overlays.export': (args: { id: string }) => boolean
  /** Creates an overlay from a file the user picks (an export, or a bare document); null if they cancel. */
  'overlays.import': () => Overlay | null
}

export type IpcChannel = keyof IpcHandlers

export type IpcResult<T> =
  { ok: true; value: T } | { ok: false; error: { type: ProblemType | 'internal'; message: string } }

/** A track for the analysis window to analyze (PLAN §7). */
export interface AnalysisJob {
  jobId: number
}

export type AnalysisReport =
  { jobId: number; ok: true; features: AudioFeatures } | { jobId: number; ok: false; error: string }

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
  /** Used only by the analysis renderer. */
  analysis: {
    onJob(listener: (job: AnalysisJob) => void): () => void
    report(report: AnalysisReport): void
    /** The CLAP audio encoder's ONNX bytes, once downloaded. */
    model(): Promise<Uint8Array>
    /** The encoded audio of a job's track (a local file, or the cached download). */
    audio(jobId: number): Promise<Uint8Array>
  }
}

export const IPC = {
  invoke: 'halocline:invoke',
  event: 'halocline:event',
  playerCommand: 'halocline:player-command',
  playerReport: 'halocline:player-report',
  analysisJob: 'halocline:analysis-job',
  analysisReport: 'halocline:analysis-report',
  analysisModel: 'halocline:analysis-model',
  analysisAudio: 'halocline:analysis-audio',
} as const
