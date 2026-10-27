import {
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCore, type Core, type ScanStatus } from '../src'
import { PNG, writeWav } from './fixtures'

let dir: string
let music: string
let artwork: string
let core: Core

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'halocline-scan-'))
  music = join(dir, 'Music')
  artwork = join(dir, 'artwork')
})
afterEach(async () => {
  await core.close()
  rmSync(dir, { recursive: true, force: true })
})

function setup(watch = false) {
  core = createCore({
    dbPath: ':memory:',
    scanner: { artworkDir: artwork, watch, debounceMs: 100 },
  })
  core.settings.patch({ library: { folders: [music] } })
  return core
}

const byTitle = (title: string) => core.library.search(title)[0]
const sourcesOf = (title: string) => core.library.sources(byTitle(title)!.id)

/** How long one watcher round trip (file event, debounce, scan) may take on a slow CI runner. */
const WATCH_TIMEOUT_MS = 10_000

describe('LibraryScanner', () => {
  it('reads tags, duration and cover art, and skips non-audio and hidden files', async () => {
    writeWav(
      join(music, 'Artist/Album/01.wav'),
      {
        title: 'First Light',
        artist: 'The Haloclines',
        album: 'Deep Water',
        isrc: 'US-ABC-26-00001',
        cover: PNG,
      },
      2,
    )
    writeWav(join(music, 'Artist/Album/02.wav'), {
      title: 'Second Tide',
      artist: 'The Haloclines',
      cover: PNG,
    })
    writeWav(join(music, 'untagged song.wav'))
    writeWav(join(music, '.hidden/secret.wav'), { title: 'Hidden' })
    writeFileSync(join(music, 'notes.txt'), 'not audio')

    await setup().scanner.start()

    const first = byTitle('first light')!
    expect(first).toMatchObject({
      artists: ['The Haloclines'],
      album: 'Deep Water',
      isrc: 'USABC2600001',
      durationMs: 2000,
      inLibrary: true,
    })
    expect(first.artwork).toMatch(/^[0-9a-f]{40}\.png$/)
    expect(byTitle('second tide')!.artwork).toBe(first.artwork) // shared art is stored once
    expect(readdirSync(artwork)).toHaveLength(1)
    expect(byTitle('untagged')).toMatchObject({ title: 'untagged song', artists: [] })
    expect(core.library.search('hidden')).toEqual([])
    expect(core.scanner.status()).toMatchObject({ state: 'idle', found: 3, processed: 3, added: 3 })
  })

  it('rescans incrementally, re-reading only changed files', async () => {
    writeWav(join(music, 'a.wav'), { title: 'Alpha' })
    writeWav(join(music, 'b.wav'), { title: 'Bravo' })
    await setup().scanner.start()

    await core.scanner.scan()
    expect(core.scanner.status()).toMatchObject({ found: 2, processed: 0 })

    writeWav(join(music, 'a.wav'), { title: 'Alpha (Remastered)' }, 2)
    await core.scanner.scan()
    expect(core.scanner.status()).toMatchObject({ found: 2, processed: 1, updated: 1, added: 0 })
    expect(byTitle('remastered')?.durationMs).toBe(2000)

    await core.scanner.scan({ full: true })
    expect(core.scanner.status()).toMatchObject({ processed: 2 })
  })

  it('marks deleted files unavailable and restores them when they return', async () => {
    const path = join(music, 'gone.wav')
    writeWav(path, { title: 'Gone' })
    await setup().scanner.start()
    const id = byTitle('gone')!.id

    rmSync(path)
    await core.scanner.scan()
    expect(core.library.sources(id)[0]?.available).toBe(false)
    expect(core.scanner.status().missing).toBe(1)

    writeWav(path, { title: 'Gone' })
    await core.scanner.scan()
    expect(core.library.sources(id)[0]?.available).toBe(true)
  })

  it('relinks a moved file to its recording, keeping its flags', async () => {
    writeWav(join(music, 'old/song.wav'), { title: 'Wanderer' })
    await setup().scanner.start()
    const before = byTitle('wanderer')!
    core.library.update(before.id, { streamSafe: true })

    renameSync(join(music, 'old'), join(music, 'new'))
    await core.scanner.scan()

    const results = core.library.search('wanderer')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: before.id, streamSafe: true })
    expect(sourcesOf('wanderer')).toEqual([
      expect.objectContaining({ locator: join(music, 'new/song.wav'), available: true }),
    ])
  })

  it('attaches a file to an existing recording with the same ISRC', async () => {
    setup()
    const cloud = core.library.create({ title: 'Cloud Copy', artists: ['X'], isrc: 'GBXYZ2600042' })
    core.library.addSource(cloud.id, { kind: 'ytm', locator: 'dQw4w9WgXcQ' })
    writeWav(join(music, 'local copy.wav'), { title: 'Local Copy', isrc: 'GBXYZ2600042' })
    await core.scanner.start()

    expect(core.library.search('local copy')).toEqual([])
    expect(core.library.get(cloud.id)?.inLibrary).toBe(true)
    expect(
      core.library
        .sources(cloud.id)
        .map((s) => s.kind)
        .sort(),
    ).toEqual(['local', 'ytm'])
  })

  it('makes files unavailable when their folder leaves the library', async () => {
    writeWav(join(music, 'a.wav'), { title: 'Alpha' })
    await setup().scanner.start()
    core.settings.patch({ library: { folders: [] } })
    await vi.waitFor(() => expect(sourcesOf('alpha')[0]?.available).toBe(false))
  })

  it('reports progress as scan.changed events', async () => {
    writeWav(join(music, 'a.wav'), { title: 'Alpha' })
    setup()
    const states: ScanStatus['state'][] = []
    core.events.subscribe((e) => e.type === 'scan.changed' && states.push(e.data.state))
    await core.scanner.start()
    expect(states[0]).toBe('scanning')
    expect(states.at(-1)).toBe('idle')
  })

  it(
    'picks up added, changed and deleted files while watching',
    async () => {
      writeWav(join(music, 'a.wav'), { title: 'Alpha' })
      await setup(true).scanner.start()

      writeWav(join(music, 'sub/b.wav'), { title: 'Bravo' })
      await vi.waitFor(() => expect(byTitle('bravo')).toBeDefined(), { timeout: WATCH_TIMEOUT_MS })

      writeWav(join(music, 'a.wav'), { title: 'Alpha Prime' })
      utimesSync(join(music, 'a.wav'), new Date(), new Date(Date.now() + 5000))
      await vi.waitFor(() => expect(byTitle('prime')).toBeDefined(), { timeout: WATCH_TIMEOUT_MS })

      rmSync(join(music, 'sub'), { recursive: true })
      await vi.waitFor(() => expect(sourcesOf('bravo')[0]?.available).toBe(false), {
        timeout: WATCH_TIMEOUT_MS,
      })
      expect(existsSync(join(music, 'a.wav'))).toBe(true)
    },
    4 * WATCH_TIMEOUT_MS,
  )
})
