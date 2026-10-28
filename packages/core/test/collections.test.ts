import { afterEach, describe, expect, it } from 'vitest'
import { createCore, type Core, type YtmCollectionDetail } from '../src'
import { fakeYtm, ytmSong } from './helpers'

let core: Core
afterEach(() => core?.close())

const DISCOVERY: YtmCollectionDetail = {
  ref: 'ytm-album:MPREb_discovery',
  kind: 'album',
  title: 'Discovery',
  by: 'Daft Punk',
  year: '2001',
  artwork: null,
  songs: [
    ytmSong('aaaaaaaaaaa', 'One More Time'),
    ytmSong('bbbbbbbbbbb', 'Aerodynamic'),
    ytmSong('ccccccccccc', 'Digital Love'),
  ],
}
const ESSENTIALS: YtmCollectionDetail = {
  ...DISCOVERY,
  ref: 'ytm-playlist:VLPLessentials',
  kind: 'playlist',
  title: 'Discovery Essentials',
  songs: [ytmSong('ddddddddddd', 'Voyager')],
}

function setup() {
  core = createCore({
    dbPath: ':memory:',
    ytm: fakeYtm([ytmSong('eeeeeeeeeee', 'Discovery Song')], {
      collections: [DISCOVERY, ESSENTIALS],
    }),
    autoplay: false,
  })
  return core
}

const titles = () => core.queue.list().items.map((i) => i.recording.title)

describe('albums and playlists', () => {
  it('show up in search after the songs', async () => {
    setup()
    const results = await core.catalog.search('discovery')
    expect(results.map((r) => r.kind)).toEqual(['ytm', 'ytm-collection', 'ytm-collection'])
    expect(results.slice(1)).toMatchObject([
      { collection: { ref: DISCOVERY.ref, kind: 'album', by: 'Daft Punk' } },
      { collection: { ref: ESSENTIALS.ref, kind: 'playlist' } },
    ])
  })

  it('queue whole, in order, at the end or next', async () => {
    setup()
    const first = core.library.create({ title: 'Already queued', artists: [], inLibrary: true })
    core.queue.add({ recordingId: first.id, origin: 'user' })
    const changes: number[] = []
    core.events.subscribe((e) => e.type === 'library.changed' && changes.push(1))
    const revision = core.queue.revision

    const added = await core.catalog.enqueueCollection(DISCOVERY.ref, { origin: 'user' })
    expect(added).toMatchObject({ collection: { title: 'Discovery' }, skipped: 0 })
    expect(added.items).toHaveLength(3)
    expect(titles()).toEqual(['Already queued', 'One More Time', 'Aerodynamic', 'Digital Love'])
    // One queue change and one library change for the lot.
    expect(core.queue.revision).toBe(revision + 1)
    expect(changes).toHaveLength(1)

    await core.catalog.enqueueCollection(ESSENTIALS.ref, { origin: 'user', position: 'next' })
    expect(titles()[0]).toBe('Voyager')
    // Queued cloud songs aren't saved to the library.
    expect(core.queue.list().items[2]!.recording).toMatchObject({
      title: 'One More Time',
      inLibrary: false,
    })
  })

  it('keep to stream-safe songs in stream-safe mode', async () => {
    setup()
    const tagged = core.library.ensureYtmSong(DISCOVERY.songs[1]!)
    core.library.edit(tagged.id, { streamSafe: true })
    core.settings.patch({ streamSafeMode: true })
    const added = await core.catalog.enqueueCollection(DISCOVERY.ref, { origin: 'api' })
    expect(added.skipped).toBe(2)
    expect(titles()).toEqual(['Aerodynamic'])
  })

  it('reject refs that are wrong or unknown', async () => {
    setup()
    await expect(core.catalog.collection('ytm:aaaaaaaaaaa')).rejects.toMatchObject({
      type: 'invalid_request',
    })
    await expect(core.catalog.collection('ytm-album:MPREb_nothing')).rejects.toMatchObject({
      type: 'not_found',
    })
  })
})
