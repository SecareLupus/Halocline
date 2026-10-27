import { afterEach, describe, expect, it } from 'vitest'
import type { Core } from '../src'
import { testCore } from './helpers'

let core: Core
afterEach(() => core.close())

describe('TokenService', () => {
  it('stores only a hash and verifies the secret', () => {
    core = testCore()
    const { secret, token } = core.tokens.create('bot', ['read', 'queue:add'])
    expect(secret).toMatch(/^hl_/)
    const stored = core.db.prepare('SELECT hash FROM api_tokens').get() as { hash: string }
    expect(stored.hash).not.toContain(secret)
    expect(core.tokens.verify(secret)?.id).toBe(token.id)
    expect(core.tokens.verify('hl_wrong')).toBeUndefined()
    core.tokens.revoke(token.id)
    expect(core.tokens.verify(secret)).toBeUndefined()
  })

  it('keeps overlay tokens overlay-only', () => {
    core = testCore()
    expect(() => core.tokens.create('obs', ['overlay', 'read'])).toThrow(/Overlay/)
  })
})
