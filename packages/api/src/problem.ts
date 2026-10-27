import type { ProblemType } from '@halocline/core'
import { z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type ApiProblemType =
  ProblemType | 'unauthorized' | 'forbidden' | 'validation_failed' | 'rate_limited'

const STATUS: Record<ApiProblemType, ContentfulStatusCode> = {
  invalid_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  stream_safe_violation: 409,
  revision_mismatch: 412,
  match_ambiguous: 422,
  rate_limited: 429,
  not_implemented: 501,
  provider_unavailable: 503,
}

/** RFC 9457 problem details. `type` is a bare code that bots can switch on. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
})

export function problem(
  c: Context,
  type: ApiProblemType,
  detail?: string,
  extra?: Record<string, unknown>,
): Response {
  const status = STATUS[type]
  const body = { type, title: type.replaceAll('_', ' '), status, detail, ...extra }
  return c.body(JSON.stringify(body), status, { 'Content-Type': 'application/problem+json' })
}

const problemContent = { 'application/problem+json': { schema: Problem } }

/** Error responses every authenticated route can return, for the OpenAPI document. */
export const authErrors = {
  401: { description: 'Missing or invalid token', content: problemContent },
  403: { description: 'Token lacks the required scope', content: problemContent },
  429: {
    description: "Over the token's rate limit; see Retry-After",
    content: problemContent,
  },
} as const

export const errorResponse = (description: string) => ({ description, content: problemContent })
