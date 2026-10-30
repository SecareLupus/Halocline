import { DomainError } from '@halocline/core'
import type { Context } from 'hono'

/** Reads an expected revision from `If-Match`, accepting `"12"`, `W/"12"` or `12`. */
export function expectedRevision(c: Context): number | undefined {
  const raw = c.req.header('If-Match')
  if (!raw || raw === '*') return undefined
  const n = Number(raw.replace(/^W\//, '').replaceAll('"', ''))
  if (!Number.isInteger(n) || n < 0) throw new DomainError('invalid_request', 'Bad If-Match header')
  return n
}
