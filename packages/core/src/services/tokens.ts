import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Db } from '../db'
import { DomainError } from '../errors'
import type { ApiToken, Scope } from '../schemas'

interface TokenRow {
  id: string
  name: string
  hash: string
  scopes: string
  rate_limit_per_min: number | null
  created_at: string
  last_used_at: string | null
}

const toToken = (r: TokenRow): ApiToken => ({
  id: r.id,
  name: r.name,
  scopes: JSON.parse(r.scopes) as Scope[],
  rateLimitPerMin: r.rate_limit_per_min,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
})

const OVERLAY_KEY = 'overlay_token'

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex')

/**
 * Named, scoped API bearer tokens. Only a hash is stored; the secret is shown
 * once at creation. Overlay tokens may only carry the `overlay` scope (PLAN §6),
 * because they end up in OBS scene files and must be harmless if leaked.
 */
export class TokenService {
  constructor(private readonly db: Db) {}

  create(
    name: string,
    scopes: Scope[],
    rateLimitPerMin?: number,
  ): { secret: string; token: ApiToken } {
    if (scopes.includes('overlay') && scopes.length > 1) {
      throw new DomainError('invalid_request', 'Overlay tokens cannot carry other scopes')
    }
    const id = randomUUID()
    const secret = `hl_${randomBytes(32).toString('base64url')}`
    this.db
      .prepare(
        `INSERT INTO api_tokens (id, name, hash, scopes, rate_limit_per_min, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        hash(secret),
        JSON.stringify(scopes),
        rateLimitPerMin ?? null,
        new Date().toISOString(),
      )
    return { secret, token: this.require(id) }
  }

  /** Returns the token for a secret, or undefined if it's unknown or revoked. */
  verify(secret: string): ApiToken | undefined {
    const row = this.db.prepare('SELECT * FROM api_tokens WHERE hash = ?').get(hash(secret)) as
      TokenRow | undefined
    if (!row) return undefined
    const now = new Date().toISOString()
    this.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id)
    return toToken({ ...row, last_used_at: now })
  }

  list(): ApiToken[] {
    const rows = this.db.prepare('SELECT * FROM api_tokens ORDER BY created_at').all() as TokenRow[]
    return rows.map(toToken)
  }

  revoke(id: string): void {
    const { changes } = this.db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id)
    if (!changes) throw new DomainError('not_found', `No token with id ${id}`)
  }

  /**
   * The OBS overlay's token secret, created on first use (PLAN §8). Unlike other
   * secrets it's kept, so the overlay URL can be copied again: it can only read
   * what's playing, and it lives in OBS scene files anyway.
   */
  overlaySecret(): string {
    const stored = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(OVERLAY_KEY) as
      { value: string } | undefined
    if (stored) {
      const { id, secret } = JSON.parse(stored.value) as { id: string; secret: string }
      if (this.db.prepare('SELECT 1 FROM api_tokens WHERE id = ?').get(id)) return secret
    }
    const { secret, token } = this.create('OBS overlay', ['overlay'])
    this.db
      .prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)')
      .run(OVERLAY_KEY, JSON.stringify({ id: token.id, secret }))
    return secret
  }

  /** Replaces the overlay token, e.g. if its URL leaked somewhere unwanted. */
  rotateOverlay(): string {
    const stored = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(OVERLAY_KEY) as
      { value: string } | undefined
    if (stored) {
      const { id } = JSON.parse(stored.value) as { id: string }
      this.db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM kv WHERE key = ?').run(OVERLAY_KEY)
    }
    return this.overlaySecret()
  }

  private require(id: string): ApiToken {
    const row = this.db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(id) as
      TokenRow | undefined
    if (!row) throw new DomainError('not_found', `No token with id ${id}`)
    return toToken(row)
  }
}
