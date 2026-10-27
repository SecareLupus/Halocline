import type { Engine, Source } from '../schemas'

export interface SourceChoice {
  source: Source
  engine: Engine
}

/**
 * Picks where to play a recording from, at play time (PLAN §3): the pinned
 * source if set, otherwise local, then cache, then YTM direct, then the YTM
 * fallback window. `isCached` says whether a source is in the prefetch cache.
 */
export function chooseSource(
  sources: Source[],
  opts: {
    pinnedSourceId?: string | null
    isCached?: (source: Source) => boolean
    directAllowed: boolean
    /** False while no YTM engine exists; YTM sources are then skipped, not tried. */
    ytmPlayable?: boolean
  },
): SourceChoice | undefined {
  const usable = sources.filter(
    (s) => s.available && (s.kind !== 'ytm' || opts.ytmPlayable !== false),
  )
  const pinned = opts.pinnedSourceId && usable.find((s) => s.id === opts.pinnedSourceId)
  const ordered = pinned ? [pinned] : [...usable].sort((a, b) => rank(a) - rank(b))

  for (const source of ordered) {
    if (source.kind === 'local') return { source, engine: 'local' }
    if (opts.isCached?.(source)) return { source, engine: 'cache' }
    if (source.kind === 'ytm') return { source, engine: opts.directAllowed ? 'direct' : 'fallback' }
  }
  return undefined
}

const rank = (s: Source) => (s.kind === 'local' ? 0 : 1)
