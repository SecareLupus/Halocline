import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readLocalFile } from '../src'

const dir = mkdtempSync(join(tmpdir(), 'halocline-local-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const file = join(dir, 'song.mp3')
writeFileSync(file, Buffer.from('0123456789'))

describe('readLocalFile', () => {
  it('serves the whole file, saying ranges are accepted', async () => {
    const res = await readLocalFile(file, null)
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(await res.text()).toBe('0123456789')
  })

  it('answers byte ranges with 206, which is what makes seeking possible', async () => {
    const res = await readLocalFile(file, 'bytes=2-5')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(res.headers.get('content-length')).toBe('4')
    expect(await res.text()).toBe('2345')
    expect(await (await readLocalFile(file, 'bytes=7-')).text()).toBe('789')
    expect(await (await readLocalFile(file, 'bytes=-3')).text()).toBe('789')
  })

  it('refuses ranges past the end and missing files', async () => {
    expect((await readLocalFile(file, 'bytes=20-30')).status).toBe(416)
    expect((await readLocalFile(join(dir, 'gone.mp3'), null)).status).toBe(404)
  })
})
