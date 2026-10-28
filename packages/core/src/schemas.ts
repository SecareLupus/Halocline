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

/** Recordings that are the same song, merged into the one in the path (PLAN §3). */
export const MergeRecordings = z.object({
  from: z.array(Id).min(1).max(50),
})
export type MergeRecordings = z.infer<typeof MergeRecordings>

/** Sources that aren't the song the recording is, moved onto a new recording (PLAN §3). */
export const SplitRecording = z.object({
  sourceIds: z.array(Id).min(1).max(50),
})
export type SplitRecording = z.infer<typeof SplitRecording>

export const SplitResult = z.object({
  /** The recording split from, with the sources it kept. */
  original: RecordingDetail,
  /** The new recording, with the sources moved onto it. */
  split: RecordingDetail,
})
export type SplitResult = z.infer<typeof SplitResult>

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

/** A channel the signed-in Google account can use YouTube Music as. */
export const YtmAccount = z.object({
  /** Pass to `PUT /v1/ytm/account` to use this channel. */
  id: z.string(),
  name: z.string(),
  /** e.g. "@SecareLupusYT". */
  handle: z.string().nullable(),
  photo: z.string().nullable(),
  /** The channel requests run as now. */
  selected: z.boolean(),
  /** Opens this channel in a browser session (the app's YouTube Music window uses it). */
  switchUrl: z.string().nullable(),
})
export type YtmAccount = z.infer<typeof YtmAccount>

export const YtmStatus = z.object({
  signedIn: z.boolean(),
  /** Display name of the channel requests run as, when signed in. */
  account: z.string().nullable(),
  /** The chosen channel's `YtmAccount.id`; null means the Google account's own. */
  accountId: z.string().nullable(),
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

/** Services whose track links the resolver reads (PLAN §5). */
export const LinkProvider = z.enum(['ytm', 'youtube', 'spotify', 'tidal', 'apple', 'deezer'])
export type LinkProvider = z.infer<typeof LinkProvider>

/** What a link was read as, before matching. */
export const LinkMetadata = z.object({
  provider: LinkProvider,
  title: z.string(),
  artists: z.array(z.string()),
  album: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  isrc: z.string().nullable(),
})
export type LinkMetadata = z.infer<typeof LinkMetadata>

/** A song a link (or query) may mean, with how sure the resolver is. */
export const ResolveCandidate = z.object({
  /** Pass back as `input` (e.g. to `POST /v1/queue/items`) to pick this one. */
  input: z.string(),
  source: z.enum(['library', 'ytm']),
  title: z.string(),
  artists: z.array(z.string()),
  album: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  artwork: z.string().nullable(),
  score: z.number().min(0).max(1),
})
export type ResolveCandidate = z.infer<typeof ResolveCandidate>

export const Resolution = z.object({
  /** What the link was read as; null when the input wasn't a link. */
  link: LinkMetadata.nullable(),
  /** Set when one candidate is confident enough to play without asking. */
  match: ResolveCandidate.nullable(),
  /** Best first, the match included. */
  candidates: z.array(ResolveCandidate),
  /** Whether the match came from the resolution cache. */
  cached: z.boolean(),
})
export type Resolution = z.infer<typeof Resolution>

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
  /** Where it can play from, e.g. to offer a choice for `pinnedSourceId`. */
  sources: z.array(Source),
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
      /** Songs are added while the queue is shorter than this (PLAN §7). */
      minQueueLength: z.number().int().min(0).max(50).default(2),
      /** `all` adds YouTube Music songs too; `library` only what you've saved or own. */
      sources: z.enum(['all', 'library']).default('all'),
      /** 0 takes the closest match; 1 picks freely among many good ones. */
      adventurousness: z.number().min(0).max(1).default(0.3),
      /** No artist again within this many songs. */
      artistGap: z.number().int().min(0).max(20).default(3),
      /** Nothing played in the last this-many hours. */
      recentHours: z.number().min(0).max(168).default(3),
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
  analysis: z
    .object({
      /** Analyze local files and cached cloud tracks for autoplay (PLAN §7). */
      enabled: z.boolean().default(true),
      /**
       * Keep analyzing while music plays. Off by default: analysis keeps a CPU core
       * busy, which could make a live stream stutter.
       */
      duringPlayback: z.boolean().default(false),
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
    analysis: Settings.shape.analysis.unwrap().partial(),
  })
  .partial()
  .strict()
export type SettingsPatch = z.infer<typeof SettingsPatch>

/** One recording's audio analysis (PLAN §7); anything the analyzer couldn't measure is null. */
export const AudioFeatures = z.object({
  bpm: z.number().positive().max(400).nullable(),
  /** Camelot wheel notation, e.g. "8A" (A minor) or "8B" (C major). */
  camelotKey: z
    .string()
    .regex(/^(1[0-2]|[1-9])[AB]$/)
    .nullable(),
  loudnessLufs: z.number().min(-100).max(20).nullable(),
  /** 0 (calm) to 1 (intense). */
  energy: z.number().min(0).max(1).nullable(),
  /** CLAP audio embedding, unit length; similar-sounding songs point the same way. */
  embedding: z.array(z.number()).length(512).nullable(),
})
export type AudioFeatures = z.infer<typeof AudioFeatures>

/** Progress of audio analysis (PLAN §7). */
export const AnalysisStatus = z.object({
  enabled: z.boolean(),
  /** The CLAP model is downloaded once (78 MB) before anything is analyzed. */
  model: z.object({
    state: z.enum(['unavailable', 'missing', 'downloading', 'ready', 'failed']),
    /** Download progress, 0 to 1. */
    progress: z.number().min(0).max(1),
    error: z.string().nullable(),
  }),
  analyzed: z.number().int().nonnegative(),
  /** Tracks that couldn't be analyzed (e.g. undecodable); not retried. */
  failed: z.number().int().nonnegative(),
  /** Local files and cached cloud tracks still to analyze. */
  pending: z.number().int().nonnegative(),
  /** Title of the track being analyzed. */
  current: z.string().nullable(),
  /** Waiting for playback to stop (unless analysis during playback is on). */
  pausedForPlayback: z.boolean(),
  lastError: z.string().nullable(),
})
export type AnalysisStatus = z.infer<typeof AnalysisStatus>

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
