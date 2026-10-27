import type { QueuePosition, SourceKind } from '@halocline/core'
import { createSignal, For, Show } from 'solid-js'
import { call } from './bridge'
import { TrackLabel } from './Search'
import type { AppState } from './store'

const SOURCE_LABELS: Record<SourceKind, string> = { local: 'Local file', ytm: 'YouTube Music' }
/** The play-time preference order (PLAN §3), so the menu reads the same way. */
const SOURCE_ORDER: Record<SourceKind, number> = { local: 0, ytm: 1 }

export function QueueList(props: { state: AppState }) {
  const [dragging, setDragging] = createSignal<string | null>(null)
  const items = () => props.state.queue().items
  const streamSafeMode = () => props.state.settings()?.streamSafeMode ?? false

  /** Drops the dragged item after the target (or first, when dropped on the top item's upper half). */
  const drop = (targetId: string, before: boolean) => {
    const id = dragging()
    setDragging(null)
    if (!id || id === targetId) return
    const index = items().findIndex((i) => i.id === targetId)
    const prev = items()[index - 1]
    const position: QueuePosition = !before
      ? { after: targetId }
      : prev
        ? { after: prev.id }
        : 'next'
    void props.state.run(() => call('queue.move', { id, position }))
  }

  return (
    <section class="pane">
      <h2>Up next</h2>
      <Show when={items().length} fallback={<p class="empty">The queue is empty.</p>}>
        <ol class="list">
          <For each={items()}>
            {(item) => (
              <li
                draggable="true"
                classList={{ dragging: dragging() === item.id }}
                onDragStart={() => setDragging(item.id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const box = e.currentTarget.getBoundingClientRect()
                  drop(item.id, e.clientY < box.top + box.height / 2)
                }}
              >
                <TrackLabel track={item.recording} />
                <span class="actions">
                  <Show when={streamSafeMode() && !item.recording.streamSafe}>
                    <span
                      class="badge warning-badge"
                      title="Stream-safe mode is on and this song isn't tagged stream-safe"
                    >
                      will be skipped
                    </span>
                  </Show>
                  <Show when={item.origin !== 'user'}>
                    <span class="badge">{item.requestedBy ?? item.origin}</span>
                  </Show>
                  <Show when={item.sources.length > 1}>
                    <select
                      aria-label="Play from"
                      title="Where to play this from"
                      value={item.pinnedSourceId ?? ''}
                      onChange={(e) => {
                        const sourceId = e.currentTarget.value || null
                        void props.state.run(() => call('queue.pin', { id: item.id, sourceId }))
                      }}
                    >
                      <option value="">Auto</option>
                      <For
                        each={[...item.sources].sort(
                          (a, b) => SOURCE_ORDER[a.kind] - SOURCE_ORDER[b.kind],
                        )}
                      >
                        {(source) => (
                          <option value={source.id} disabled={!source.available}>
                            {SOURCE_LABELS[source.kind]}
                          </option>
                        )}
                      </For>
                    </select>
                  </Show>
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() =>
                      void props.state.run(() => call('queue.remove', { id: item.id }))
                    }
                  >
                    ✕
                  </button>
                </span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </section>
  )
}
