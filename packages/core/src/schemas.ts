// Domain schemas shared by the core services, the IPC layer and the HTTP API.
// The API's OpenAPI document is generated from these, so they are the contract.
import { z } from 'zod'

export const Id = z.string().min(1)

export const SourceKind = z.enum(['local', 'ytm'])
export type SourceKind = z.infer<typeof SourceKind>

/** Where the audio for the current track is coming from (PLAN §4 health badges). */
export const Engine = z.enum(['local', 'cache', 'direct', 'fallback'])
export type Engine = z.infer<typeof Engine>

export const Recording = z.object({
  id: Id,
  title: z.string(),
  artists: z.array(z.string()),
  album: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  isrc: z.string().nullable(),
  artwork: z.string().nullable(),
  inLibrary: z.boolean(),
  streamSafe: z.boolean(),
  tags: z.array(z.string()),
  addedAt: z.iso.datetime(),
  playCount: z.number().int().nonnegative(),
  lastPlayedAt: z.iso.datetime().nullable(),
})
export type Recording = z.infer<typeof Recording>

export const NewRecording = Recording.pick({ title: true, artists: true }).extend(
  Recording.pick({
    album: true,
    durationMs: true,
    isrc: true,
    artwork: true,
    inLibrary: true,
    streamSafe: true,
    tags: true,
  }).partial().shape,
)
export type NewRecording = z.infer<typeof NewRecording>

export const Source = z.object({
  id: Id,
  recordingId: Id,
  kind: SourceKind,
  /** A file path for `local`, a videoId for `ytm`. */
  locator: z.string(),
  format: z.string().nullable(),
  bitrate: z.number().int().nullable(),
  available: z.boolean(),
  failureCount: z.number().int().nonnegative(),
  lastChecked: z.iso.datetime().nullable(),
})
export type Source = z.infer<typeof Source>

export const NewSource = Source.pick({ kind: true, locator: true }).extend(
  Source.pick({ format: true, bitrate: true }).partial().shape,
)
export type NewSource = z.infer<typeof NewSource>

export const Tag = z.string().trim().min(1).max(50)

/** A library row: the recording plus which kinds of source can play it right now. */
export const LibraryEntry = Recording.extend({
  available: z.boolean(),
  sourceKinds: z.array(SourceKind),
})
export type LibraryEntry = z.infer<typeof LibraryEntry>

export const RecordingDetail = Recording.extend({ sources: z.array(Source) })
export type RecordingDetail = z.infer<typeof RecordingDetail>

export const LibrarySort = z.enum(['title', 'artist', 'added'])
export type LibrarySort = z.infer<typeof LibrarySort>

export const LibraryQuery = z.object({
  /** Full-text filter over title, artists and album. */
  q: z.string().max(200).optional(),
  inLibrary: z.boolean().default(true),
  streamSafe: z.boolean().optional(),
  /** Only recordings that can (or can't) be played right now. */
  available: z.boolean().optional(),
  tag: Tag.optional(),
  sort: LibrarySort.default('title'),
  limit: z.number().int().min(1).max(200).default(50),
  /** Opaque; from a previous page's `nextCursor`. */
  cursor: z.string().max(1000).optional(),
})
export type LibraryQuery = z.input<typeof LibraryQuery>

export const LibraryPage = z.object({
  items: z.array(LibraryEntry),
  nextCursor: z.string().nullable(),
})
export type LibraryPage = z.infer<typeof LibraryPage>

export const RecordingPatch = z
  .object({
    inLibrary: z.boolean(),
    streamSafe: z.boolean(),
    /** Replaces all tags. */
    tags: z.array(Tag).max(50),
    /** Adds or removes tags, leaving others alone; safe for bulk edits. */
    addTags: z.array(Tag).max(50),
    removeTags: z.array(Tag).max(50),
  })
  .partial()
  .strict()
  .refine((p) => !(p.tags && (p.addTags || p.removeTags)), {
    message: 'Use either tags, or addTags/removeTags',
  })
export type RecordingPatch = z.infer<typeof RecordingPatch>

export const BulkRecordingPatch = z.object({
  ids: z.array(Id).min(1).max(1000),
  changes: RecordingPatch,
})
export type BulkRecordingPatch = z.infer<typeof BulkRecordingPatch>

export const BulkResult = z.object({
  updated: z.number().int().nonnegative(),
  notFound: z.array(Id),
})
export type BulkResult = z.infer<typeof BulkResult>

/** A YouTube Music song as the provider describes it, before it's in the database. */
export const YtmSong = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string(),
  artists: z.array(z.string()),
  album: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  artwork: z.url().nullable(),
})
export type YtmSong = z.infer<typeof YtmSong>

export const YtmStatus = z.object({
  signedIn: z.boolean(),
  /** Account display name, when signed in and YouTube returns one. */
  account: z.string().nullable(),
  /** Whether any engine can play YTM songs yet. Search and queueing work regardless. */
  playback: z.boolean(),
  lastError: z.string().nullable(),
})
export type YtmStatus = z.infer<typeof YtmStatus>

/** Unified search: library hits first, then YTM songs not already in the library. */
export const SearchResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('library'), recording: Recording, sources: z.array(Source) }),
  z.object({
    kind: z.literal('ytm'),
    /** Pass as `input` to POST /v1/queue/items to enqueue it. */
    ref: z.string(),
    song: YtmSong,
  }),
])
export type SearchResult = z.infer<typeof SearchResult>

export const QueueOrigin = z.enum(['user', 'api', 'autoplay'])
export type QueueOrigin = z.infer<typeof QueueOrigin>

export const QueueItem = z.object({
  id: Id,
  recordingId: Id,
  pinnedSourceId: Id.nullable(),
  origin: QueueOrigin,
  requestedBy: z.string().nullable(),
  addedAt: z.iso.datetime(),
  recording: Recording,
})
export type QueueItem = z.infer<typeof QueueItem>

export const Queue = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(QueueItem),
})
export type Queue = z.infer<typeof Queue>

/** Queue positions are expressed relative to stable item IDs, never indexes (PLAN §6). */
export const QueuePosition = z.union([z.literal('next'), z.literal('end'), z.object({ after: Id })])
export type QueuePosition = z.infer<typeof QueuePosition>

export const RepeatMode = z.enum(['off', 'one', 'all'])
export type RepeatMode = z.infer<typeof RepeatMode>

export const NowPlaying = z.object({
  queueItemId: Id,
  recording: Recording,
  sourceId: Id,
  engine: Engine,
})
export type NowPlaying = z.infer<typeof NowPlaying>

export const PlayerState = z.object({
  playing: z.boolean(),
  /** Position at the moment `positionAt` (epoch ms); clients extrapolate between events. */
  positionMs: z.number().int().nonnegative(),
  positionAt: z.number().int(),
  volume: z.number().min(0).max(1),
  repeat: RepeatMode,
  shuffle: z.boolean(),
  /** True while the fallback engine is playing an ad; never shown as the track. */
  ad: z.boolean(),
  current: NowPlaying.nullable(),
})
export type PlayerState = z.infer<typeof PlayerState>

export const OutputDevice = z.object({ deviceId: z.string(), label: z.string() })
export type OutputDevice = z.infer<typeof OutputDevice>

/** Audio outputs the player can see, and the one it's actually using. */
export const OutputState = z.object({
  devices: z.array(OutputDevice),
  /** Empty means the system default. Differs from the setting if that device is missing. */
  activeDeviceId: z.string(),
  error: z.string().nullable(),
})
export type OutputState = z.infer<typeof OutputState>

export const PlayerPatch = z
  .object({
    playing: z.boolean(),
    volume: z.number().min(0).max(1),
    positionMs: z.number().int().nonnegative(),
    repeat: RepeatMode,
    shuffle: z.boolean(),
  })
  .partial()
  .strict()
export type PlayerPatch = z.infer<typeof PlayerPatch>

export const Settings = z.object({
  streamSafeMode: z.boolean().default(false),
  autoplay: z
    .object({
      enabled: z.boolean().default(true),
      minQueueLength: z.number().int().min(0).max(50).default(2),
    })
    .prefault({}),
  api: z
    .object({
      bindAddress: z.string().default('127.0.0.1'),
      port: z.number().int().min(1).max(65535).default(17380),
    })
    .prefault({}),
  playback: z
    .object({
      /** Audio output device ID from the player; empty means the system default. */
      outputDeviceId: z.string().default(''),
      /** Crossfade between tracks; 0 means gapless. */
      crossfadeMs: z.number().int().min(0).max(12_000).default(0),
      /** Play consecutive tracks from the same album gapless, even with crossfade on. */
      gaplessAlbums: z.boolean().default(true),
    })
    .prefault({}),
  library: z
    .object({
      /** Folders scanned and watched for local music. */
      folders: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
})
export type Settings = z.infer<typeof Settings>

export const SettingsPatch = z
  .object({
    streamSafeMode: z.boolean(),
    autoplay: Settings.shape.autoplay.unwrap().partial(),
    api: Settings.shape.api.unwrap().partial(),
    playback: Settings.shape.playback.unwrap().partial(),
    library: Settings.shape.library.unwrap().partial(),
  })
  .partial()
  .strict()
export type SettingsPatch = z.infer<typeof SettingsPatch>

export const HealthStatus = z.enum(['green', 'amber', 'red'])
export type HealthStatus = z.infer<typeof HealthStatus>

export const Health = z.object({
  /** green: direct works · amber: fallback used recently · red: circuit breaker open. */
  status: HealthStatus,
  direct: z.object({
    consecutiveFailures: z.number().int().nonnegative(),
    breakerOpenUntil: z.number().int().nullable(),
    lastError: z.string().nullable(),
  }),
  lastFallbackAt: z.number().int().nullable(),
})
export type Health = z.infer<typeof Health>

export const ScanStatus = z.object({
  state: z.enum(['idle', 'scanning']),
  /** `walking` lists files; `reading` parses tags of new or changed files. */
  phase: z.enum(['walking', 'reading']).nullable(),
  found: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
  lastError: z.string().nullable(),
})
export type ScanStatus = z.infer<typeof ScanStatus>

export const Scope = z.enum([
  'read',
  'player:control',
  'queue:add',
  'queue:manage',
  'library:write',
  'admin',
  'overlay',
])
export type Scope = z.infer<typeof Scope>

export const ApiToken = z.object({
  id: Id,
  name: z.string().min(1).max(100),
  scopes: z.array(Scope).min(1),
  rateLimitPerMin: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
})
export type ApiToken = z.infer<typeof ApiToken>
