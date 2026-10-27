// Builds small WAV files with ID3v2.3 tags, so scanner tests need no binary fixtures.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Tags {
  title?: string
  artist?: string
  album?: string
  isrc?: string
  cover?: Buffer
}

/** A 1×1 PNG, standing in for cover art. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const u32be = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const u32le = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const synchsafe = (n: number) =>
  Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])

const frame = (id: string, data: Buffer) =>
  Buffer.concat([Buffer.from(id, 'latin1'), u32be(data.length), Buffer.alloc(2), data])
const text = (id: string, value: string) =>
  frame(id, Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')]))

function id3(tags: Tags): Buffer {
  const frames = [
    tags.title && text('TIT2', tags.title),
    tags.artist && text('TPE1', tags.artist),
    tags.album && text('TALB', tags.album),
    tags.isrc && text('TSRC', tags.isrc),
    tags.cover &&
      frame(
        'APIC',
        Buffer.concat([
          Buffer.from([0]),
          Buffer.from('image/png\0', 'latin1'),
          Buffer.from([3, 0]),
          tags.cover,
        ]),
      ),
  ].filter((f) => f instanceof Buffer) as Buffer[]
  const body = Buffer.concat(frames)
  return Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([3, 0, 0]),
    synchsafe(body.length),
    body,
  ])
}

const chunk = (id: string, data: Buffer) => {
  const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)
  return Buffer.concat([Buffer.from(id, 'latin1'), u32le(data.length), data, pad])
}

/** Writes a mono 8 kHz 16-bit WAV of `seconds` silence, tagged with `tags`. */
export function writeWav(path: string, tags: Tags = {}, seconds = 1): void {
  const rate = 8000
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(1, 0) // PCM
  fmt.writeUInt16LE(1, 2) // mono
  fmt.writeUInt32LE(rate, 4)
  fmt.writeUInt32LE(rate * 2, 8)
  fmt.writeUInt16LE(2, 12)
  fmt.writeUInt16LE(16, 14)
  const chunks = [chunk('fmt ', fmt), chunk('data', Buffer.alloc(rate * 2 * seconds))]
  if (Object.keys(tags).length) chunks.push(chunk('id3 ', id3(tags)))
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), ...chunks])
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.concat([Buffer.from('RIFF', 'latin1'), u32le(body.length), body]))
}
