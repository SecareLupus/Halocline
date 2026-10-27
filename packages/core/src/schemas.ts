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
})
export type Settings = z.infer<typeof Settings>

export const SettingsPatch = z
  .object({
    streamSafeMode: z.boolean(),
    autoplay: Settings.shape.autoplay.unwrap().partial(),
    api: Settings.shape.api.unwrap().partial(),
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
