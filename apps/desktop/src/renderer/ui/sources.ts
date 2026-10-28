import type { Source, SourceKind } from '@halocline/core'

const LABELS: Record<SourceKind, string> = { local: 'Local file', ytm: 'YouTube Music' }
/** The play-time preference order (PLAN §3), so menus read the same way. */
const ORDER: Record<SourceKind, number> = { local: 0, ytm: 1 }

export const bySourceOrder = (sources: Source[]) =>
  [...sources].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])

/** "Local file" or "YouTube Music", naming the file when there's more than one of a kind. */
export function sourceLabel(source: Source, all: Source[]): string {
  const label = LABELS[source.kind]
  if (all.filter((s) => s.kind === source.kind).length < 2) return label
  const name = source.kind === 'local' ? source.locator.split(/[\\/]/).at(-1) : source.locator
  return `${label} (${name})`
}
