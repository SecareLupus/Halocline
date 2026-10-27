import type { ApiToken, Core, Scope } from '@halocline/core'
import type { MiddlewareHandler } from 'hono'
import { problem } from './problem'

export type ApiEnv = { Variables: { token: ApiToken } }

/**
 * Bearer-token auth. OBS Browser Sources and EventSource can't send headers,
 * so `?token=` is accepted too, but only for overlay-only tokens (PLAN §6).
 */
export function authenticate(core: Core): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const header = c.req.header('Authorization')
    const bearer = header?.match(/^Bearer\s+(\S+)$/i)?.[1]
    const query = c.req.query('token')
    const token = core.tokens.verify(bearer ?? query ?? '')
    if (!token)
      return problem(c, 'unauthorized', 'Send a valid token as "Authorization: Bearer <token>"')
    if (!bearer && !isOverlayOnly(token)) {
      return problem(c, 'unauthorized', 'Only overlay tokens may be passed in the query string')
    }
    c.set('token', token)
    await next()
  }
}

/** Allows the request if the token has any of `scopes`, or `admin`. */
export function requireScope(...scopes: Scope[]): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const granted = c.get('token').scopes
    if (granted.includes('admin') || scopes.some((s) => granted.includes(s))) return next()
    return problem(c, 'forbidden', `Requires one of: ${scopes.join(', ')}`)
  }
}

export const isOverlayOnly = (token: ApiToken) =>
  token.scopes.length === 1 && token.scopes[0] === 'overlay'
