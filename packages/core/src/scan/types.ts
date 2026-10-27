// Messages between the scanner (main thread) and the scan job, which may run in
// a worker thread. Everything here must survive structured cloning.

export interface KnownFile {
  mtimeMs: number
  size: number
}

export interface ScanInput {
  /** Library folders. Walk mode lists every audio file under them. */
  roots: string[]
  /** Local files already in the database, keyed by absolute path. */
  known: Record<string, KnownFile>
  /** Paths mode: only look at these files or folders (from the watcher). */
  paths?: string[]
  /** Re-read tags even for files whose size and mtime haven't changed. */
  full?: boolean
  /** Where embedded cover art is written, named by content hash. */
  artworkDir: string
}

export interface ScannedFile {
  path: string
  mtimeMs: number
  size: number
  title: string
  artists: string[]
  album: string | null
  durationMs: number | null
  isrc: string | null
  /** File name of extracted cover art inside `artworkDir`. */
  artwork: string | null
  format: string | null
  bitrate: number | null
  /** Set when tags couldn't be read; the file is still added, titled by its name. */
  error?: string
}

export type ScanMessage =
  | { type: 'progress'; phase: 'walking' | 'reading'; found: number; processed: number }
  | { type: 'files'; files: ScannedFile[] }
  /** Files or folders that no longer exist; everything under a folder is affected. */
  | { type: 'missing'; paths: string[] }
  | { type: 'error'; message: string }

/** Runs a scan job, in-process or in a worker, delivering messages as it goes. */
export type ScanRunner = (
  input: ScanInput,
  onMessage: (message: ScanMessage) => void,
  signal: AbortSignal,
) => Promise<void>

export const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aac',
  '.wav',
  '.wma',
  '.aiff',
  '.aif',
])
