import { afterEach, describe, expect, it } from 'vitest'
import { normalizeTitle, sameRecording, type Core, type LocalFile } from '../src'
import { testCore, ytmSong } from './helpers'

let core: Core
afterEach(() => core?.close())

const id = (title: string, artists: string[], durationMs: number | null, isrc?: string) => ({
  title,
  artists,
  durationMs,
  ...(isrc && { isrc }),
})

const file = (overrides: Partial<LocalFile> = {}): LocalFile => ({
  path: '/music/one-more-time.flac',
  mtimeMs: 1,
  size: 1000,
  title: 'One More Time',
  artists: ['Daft Punk'],
  album: 'Discovery',
  durationMs: 320_000,
  isrc: null,
  artwork: null,
  format: 'flac',
  bitrate: 900,
  ...overrides,
})

const cloud = (videoId: string, title: string, durationMs: number, artists = ['Daft Punk']) => ({
  ...ytmSong(videoId, title),
  artists,
  durationMs,
})

describe('matching', () => {
  it('ignores featured artists, remaster notes, case and punctuation', () => {
    expect(normalizeTitle('Get Lucky (feat. Pharrell Williams)')).toBe('get lucky')
    expect(normalizeTitle('Get Lucky [ft. Pharrell]')).toBe('get lucky')
    expect(normalizeTitle('Heroes - 2017 Remaster')).toBe('heroes')
    expect(normalizeTitle('Heroes (Remastered 2017)')).toBe('heroes')
    expect(normalizeTitle('Café del Mar!')).toBe('cafe del mar')
    // These name different recordings, so they stay.
    expect(normalizeTitle('One More Time (Radio Edit)')).toBe('one more time radio edit')
    expect(normalizeTitle('Heroes - Live')).toBe('heroes live')
  })

  it('needs close durations and a shared artist, unless ISRCs decide', () => {
    const local = id('One More Time', ['Daft Punk'], 320_000)
    expect(sameRecording(local, id('One more time', ['Daft Punk - Topic'], 321_500))).toBe(true)
    expect(sameRecording(local, id('One More Time', ['Daft Punk'], 324_000))).toBe(false)
    expect(sameRecording(local, id('One More Time', ['Mqx'], 320_000))).toBe(false)
    expect(sameRecording(local, id('One More Time', ['Daft Punk'], null))).toBe(false)
    expect(
      sameRecording(
        id('A', ['X'], 1000, 'USABC1234567'),
        id('Completely different', ['Y'], 9_000_000, 'usabc1234567'),
      ),
    ).toBe(true)
    expect(
      sameRecording(
        id('Same', ['X'], 1000, 'USABC1234567'),
        id('Same', ['X'], 1000, 'GBXYZ7654321'),
      ),
    ).toBe(false)
  })
})

describe('merging local and cloud', () => {
  it('gives a local recording a cloud source instead of a duplicate', () => {
    core = testCore()
    const { recordingId } = core.library.saveLocalFile(file())
    core.library.edit(recordingId, { streamSafe: true, tags: ['banger'] })

    const merged = core.library.ensureYtmSong(cloud('fa5IWHDbftI', 'One More Time', 321_000))
    expect(merged.id).toBe(recordingId)
    expect(merged).toMatchObject({ streamSafe: true, tags: ['banger'], album: 'Discovery' })
    expect(
      core.library
        .sources(recordingId)
        .map((s) => s.kind)
        .sort(),
    ).toEqual(['local', 'ytm'])
    // A different edit of the song stays its own recording.
    const edit = core.library.ensureYtmSong(
      cloud('wU26xVT_vBU', 'One More Time (Radio Edit)', 321_000),
    )
    expect(edit.id).not.toBe(recordingId)
  })

  it('attaches a newly scanned file to a saved cloud song', () => {
    core = testCore()
    const saved = core.catalog.saveYtmSong(cloud('fa5IWHDbftI', 'One More Time', 321_000))
    const { recordingId, outcome } = core.library.saveLocalFile(file())
    expect(outcome).toBe('added')
    expect(recordingId).toBe(saved.id)
    expect(
      core.library
        .sources(saved.id)
        .map((s) => s.kind)
        .sort(),
    ).toEqual(['local', 'ytm'])
    // A second copy on disk doesn't merge into the same recording. (Its size differs, or the
    // scanner would take it for the first file moved, since that path doesn't exist here.)
    const copy = core.library.saveLocalFile(file({ path: '/music/copy.mp3', size: 500 }))
    expect(copy.recordingId).not.toBe(saved.id)
  })

  it('prefers the saved song when its music video matches too', () => {
    core = testCore()
    core.library.ensureYtmSong(cloud('FGBhQbmPwH8', 'One More Time', 321_000))
    const saved = core.catalog.saveYtmSong(cloud('fa5IWHDbftI', 'One More Time', 321_000))
    expect(core.library.saveLocalFile(file()).recordingId).toBe(saved.id)
  })

  it("doesn't guess when more than one recording fits", () => {
    core = testCore()
    const a = core.library.saveLocalFile(file({ path: '/a.flac' })).recordingId
    const b = core.library.saveLocalFile(
      file({ path: '/b.mp3', size: 500, durationMs: 321_000 }),
    ).recordingId
    const song = core.library.ensureYtmSong(cloud('fa5IWHDbftI', 'One More Time', 320_500))
    expect([a, b]).not.toContain(song.id)
  })
})

describe('saving to the library', () => {
  it('saves cloud songs, and tagging stream-safe saves too', () => {
    core = testCore()
    const queued = core.library.ensureYtmSong(cloud('cfH0T46sjRk', 'Elsewhere', 182_000, ['Mqx']))
    expect(queued.inLibrary).toBe(false)
    expect(core.catalog.saveYtmSong(cloud('cfH0T46sjRk', 'x', 1, ['y'])).inLibrary).toBe(true)

    const other = core.library.ensureYtmSong(cloud('bmjsUsS8QuM', 'Other', 481_000))
    expect(core.library.edit(other.id, { streamSafe: true })).toMatchObject({
      streamSafe: true,
      inLibrary: true,
    })
  })
})
