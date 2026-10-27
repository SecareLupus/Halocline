import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { parseFile, selectCover, type IPicture } from 'music-metadata'
import type { ScannedFile } from './types'

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Reads tags and embedded cover art from one audio file. */
export async function readTrack(
  path: string,
  stat: { mtimeMs: number; size: number },
  artworkDir: string,
): Promise<ScannedFile> {
  const base: ScannedFile = {
    path,
    mtimeMs: Math.round(stat.mtimeMs),
    size: stat.size,
    title: basename(path, extname(path)),
    artists: [],
    album: null,
    durationMs: null,
    isrc: null,
    artwork: null,
    format: extname(path).slice(1).toLowerCase() || null,
    bitrate: null,
  }
  try {
    const { common, format } = await parseFile(path, { skipPostHeaders: true })
    const artists = common.artists?.length ? common.artists : common.artist ? [common.artist] : []
    const cover = selectCover(common.picture)
    return {
      ...base,
      title: common.title?.trim() || base.title,
      artists: artists.map((a) => a.trim()).filter(Boolean),
      album: common.album?.trim() || null,
      durationMs: format.duration ? Math.round(format.duration * 1000) : null,
      isrc: common.isrc?.[0]?.replaceAll('-', '').toUpperCase() || null,
      artwork: cover ? await saveArtwork(cover, artworkDir) : null,
      format: format.codec ?? format.container ?? base.format,
      bitrate: format.bitrate ? Math.round(format.bitrate) : null,
    }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Writes cover art once per distinct image; albums share one file. */
async function saveArtwork(picture: IPicture, dir: string): Promise<string> {
  const ext = IMAGE_EXTENSIONS[picture.format.toLowerCase()] ?? 'img'
  const name = `${createHash('sha1').update(picture.data).digest('hex')}.${ext}`
  const file = join(dir, name)
  try {
    await access(file)
  } catch {
    await mkdir(dir, { recursive: true })
    await writeFile(file, picture.data)
  }
  return name
}
