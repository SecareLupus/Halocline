import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { readTrack } from './read'
import { AUDIO_EXTENSIONS, type ScanInput, type ScanMessage, type ScannedFile } from './types'

const READ_CONCURRENCY = 4
const BATCH_SIZE = 50
const FLUSH_MS = 250
const PROGRESS_MS = 200

interface Candidate {
  path: string
  mtimeMs: number
  size: number
}

export const isUnder = (root: string, path: string) =>
  path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

const isAudio = (path: string) => AUDIO_EXTENSIONS.has(extname(path).toLowerCase())

/**
 * One scan job. Lists files (all library folders, or just `paths`), skips the
 * ones whose size and mtime are unchanged, and reads tags from the rest. Pure
 * file-system work with no database, so it can run in a worker thread.
 */
export async function runScan(
  input: ScanInput,
  emit: (message: ScanMessage) => void,
  signal?: AbortSignal,
): Promise<void> {
  let found = 0
  let processed = 0
  let lastProgress = 0
  const progress = (phase: 'walking' | 'reading', force = false) => {
    const now = Date.now()
    if (!force && now - lastProgress < PROGRESS_MS) return
    lastProgress = now
    emit({ type: 'progress', phase, found, processed })
  }

  const seen = new Set<string>()
  const changed: Candidate[] = []
  const missing: string[] = []

  const consider = async (path: string, entry?: Dirent) => {
    if (!isAudio(path)) return
    if (entry && !entry.isFile() && !entry.isSymbolicLink()) return
    const s = await stat(path).catch(() => null)
    if (!s?.isFile()) return
    found++
    seen.add(path)
    const known = input.known[path]
    const mtimeMs = Math.round(s.mtimeMs)
    if (input.full || !known || known.mtimeMs !== mtimeMs || known.size !== s.size) {
      changed.push({ path, mtimeMs, size: s.size })
    }
    progress('walking')
  }

  /** Lists a folder tree. Returns false if the folder itself couldn't be read. */
  const walk = async (dir: string): Promise<boolean> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      emit({ type: 'error', message: `Cannot read ${dir}: ${(err as Error).message}` })
      return false
    }
    for (const entry of entries) {
      if (signal?.aborted) return true
      if (entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      // Symlinked folders aren't followed, to avoid cycles.
      if (entry.isDirectory()) await walk(path)
      else await consider(path, entry)
    }
    return true
  }

  /** Known files under `dir` that the walk didn't find have gone away. */
  const reportGone = (dir: string) => {
    for (const path of Object.keys(input.known)) {
      if (isUnder(dir, path) && !seen.has(path)) missing.push(path)
    }
  }

  progress('walking', true)
  if (input.paths) {
    for (const raw of input.paths) {
      const path = resolve(raw)
      const s = await stat(path).catch(() => null)
      if (!s) missing.push(path)
      else if (s.isDirectory()) {
        if (await walk(path)) reportGone(path)
      } else await consider(path)
    }
  } else {
    for (const raw of input.roots) {
      const root = resolve(raw)
      if (await walk(root)) reportGone(root)
    }
  }
  if (signal?.aborted) return
  progress('reading', true)

  let batch: ScannedFile[] = []
  let lastFlush = Date.now()
  const flush = () => {
    if (batch.length) emit({ type: 'files', files: batch })
    batch = []
    lastFlush = Date.now()
  }

  let next = 0
  const reader = async () => {
    while (next < changed.length && !signal?.aborted) {
      const file = changed[next++]!
      batch.push(await readTrack(file.path, file, input.artworkDir))
      processed++
      if (batch.length >= BATCH_SIZE || Date.now() - lastFlush >= FLUSH_MS) flush()
      progress('reading')
    }
  }
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, reader))
  if (signal?.aborted) return
  flush()
  if (missing.length) emit({ type: 'missing', paths: missing })
  progress('reading', true)
}
