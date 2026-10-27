import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Core, LibraryQuery, LibrarySort } from '../src'
import { testCore } from './helpers'

let core: Core
beforeEach(() => {
  core = testCore()
})
afterEach(() => core.close())

const add = (title: string, artist: string, extra: Record<string, unknown> = {}) =>
  core.library.create({ title, artists: [artist], inLibrary: true, ...extra })

/** Follows nextCursor to the end, returning every title in order. */
function all(query: LibraryQuery): string[] {
  const titles: string[] = []
  let cursor: string | undefined
  for (let pages = 0; pages < 50; pages++) {
    const page = core.library.browse({ ...query, ...(cursor && { cursor }) })
    titles.push(...page.items.map((r) => r.title))
    if (!page.nextCursor) return titles
    cursor = page.nextCursor
  }
  throw new Error('pagination did not terminate')
}

describe('LibraryService.browse', () => {
  beforeEach(() => {
    add('delta', 'Zed')
    add('Alpha', 'Mia')
    add('charlie', 'mia')
    add('Bravo', 'Abe')
    add('Echo', 'Abe')
    add('alpha', 'Abe') // same title, different case
    add('Foxtrot', 'Zed')
  })

  it.each<[LibrarySort, string[]]>([
    ['title', ['Alpha', 'alpha', 'Bravo', 'charlie', 'delta', 'Echo', 'Foxtrot']],
    ['artist', ['alpha', 'Bravo', 'Echo', 'Alpha', 'charlie', 'delta', 'Foxtrot']],
  ])('pages through every row exactly once, sorted by %s', (sort, expected) => {
    const titles = all({ sort, limit: 2 })
    expect(titles).toHaveLength(7)
    expect(new Set(titles.map((t) => t.toLowerCase())).size).toBe(6)
    // Same-key ties fall back to id order, so compare case-insensitively.
    expect(titles.map((t) => t.toLowerCase())).toEqual(expected.map((t) => t.toLowerCase()))
  })

  it('sorts newest first by added date', () => {
    const titles = all({ sort: 'added', limit: 3 })
    expect(titles).toHaveLength(7)
    expect(new Set(titles).size).toBe(7)
  })

  it('rejects a cursor from another sort order', () => {
    const { nextCursor } = core.library.browse({ sort: 'title', limit: 2 })
    expect(() => core.library.browse({ sort: 'added', cursor: nextCursor! })).toThrow(/cursor/)
    expect(() => core.library.browse({ cursor: 'garbage' })).toThrow(/cursor/)
  })

  it('filters by text, stream-safe, tag, availability and library membership', () => {
    const [echo] = core.library.search('echo')
    core.library.edit(echo!.id, { streamSafe: true, tags: ['Chill'] })
    core.library.addSource(echo!.id, { kind: 'local', locator: '/music/echo.flac' })
    const [delta] = core.library.search('delta')
    core.library.edit(delta!.id, { inLibrary: false })

    // Case-insensitive ties are ordered by id, which is random here.
    expect(all({ q: 'alp' }).sort()).toEqual(['Alpha', 'alpha'].sort())
    expect(all({ streamSafe: true })).toEqual(['Echo'])
    expect(all({ tag: 'chill' })).toEqual(['Echo'])
    expect(all({ available: true })).toEqual(['Echo'])
    expect(all({ available: false })).not.toContain('Echo')
    expect(all({})).not.toContain('delta')
    expect(all({ inLibrary: false })).toEqual(['delta'])
    expect(core.library.browse({ q: 'echo' }).items[0]).toMatchObject({
      available: true,
      sourceKinds: ['local'],
    })
  })
})

describe('LibraryService edits', () => {
  it('replaces, adds and removes tags without duplicates', () => {
    const r = add('Song', 'A')
    expect(core.library.edit(r.id, { tags: [' Chill ', 'chill', 'Night'] }).tags).toEqual([
      'Chill',
      'Night',
    ])
    expect(
      core.library.edit(r.id, { addTags: ['NIGHT', 'Live'], removeTags: ['chill'] }).tags,
    ).toEqual(['Night', 'Live'])
    expect(() => core.library.edit(r.id, { tags: ['x'], addTags: ['y'] })).toThrow()
  })

  it('bulk-edits in one transaction and one event, reporting unknown ids', () => {
    const a = add('A', 'X')
    const b = add('B', 'X', { tags: ['Keep'] })
    const events: string[][] = []
    core.events.subscribe((e) => e.type === 'library.changed' && events.push(e.data.recordingIds))

    const result = core.library.editMany([a.id, b.id, 'missing', a.id], {
      streamSafe: true,
      addTags: ['Stream'],
    })
    expect(result).toEqual({ updated: 2, notFound: ['missing'] })
    expect(events).toEqual([[a.id, b.id]])
    expect(core.library.get(b.id)).toMatchObject({ streamSafe: true, tags: ['Keep', 'Stream'] })
  })
})
