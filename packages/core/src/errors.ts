/** Machine-readable error codes, surfaced by the API as RFC 9457 problem `type`s. */
export type ProblemType =
  | 'stream_safe_violation'
  | 'match_ambiguous'
  | 'not_found'
  | 'provider_unavailable'
  | 'revision_mismatch'
  | 'not_implemented'
  | 'invalid_request'

export class DomainError extends Error {
  constructor(
    readonly type: ProblemType,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}
