import { afterEach, describe, expect, it } from 'vitest'
import { toFtsQuery, type Core } from '../src'
import { song, testCore } from './helpers'

let core: Core
afterEach(() => core.close())

describe('LibraryService', () => {
  it('searches title, artist and album with prefix matching', () => {
    core = testCore()
    song(core, 'Halocline', { artists: ['Björk'], album: 'Deep Water' })
    song(core, 'Surface Tension')
    expect(core.library.search('halo').map((r) => r.title)).toEqual(['Halocline'])
    expect(core.library.search('bjork').map((r) => r.title)).toEqual(['Halocline'])
    expect(core.library.search('deep wat').map((r) => r.title)).toEqual(['Halocline'])
    expect(core.library.search('"); DROP')).toEqual([])
  })

  it('builds FTS queries that cannot inject syntax', () => {
    expect(toFtsQuery('foo "bar" OR baz*')).toBe('"foo"* "bar"* "OR"* "baz"*')
    expect(toFtsQuery('  !!  ')).toBeUndefined()
  })
})
