import type { QueuePosition } from '@halocline/core'
import { createSignal, For, Show } from 'solid-js'
import { call } from './bridge'
import { TrackLabel } from './Search'
import { bySourceOrder, sourceLabel } from './sources'
import type { AppState } from './store'

export function QueueList(props: { state: AppState }) {
  const [dragging, setDragging] = createSignal<string | null>(null)
  /** Where a drop would land now: before or after this item. Drawn as a line. */
  const [dropAt, setDropAt] = createSignal<{ id: string; before: boolean } | null>(null)
  const half = (e: DragEvent & { currentTarget: HTMLElement }) => {
    const box = e.currentTarget.getBoundingClientRect()
    return e.clientY < box.top + box.height / 2
  }
  const endDrag = () => {
    setDragging(null)
    setDropAt(null)
  }
  const items = () => props.state.queue().items
  const streamSafeMode = () => props.state.settings()?.streamSafeMode ?? false

  /** Drops the dragged item after the target (or first, when dropped on the top item's upper half). */
  const drop = (targetId: string, before: boolean) => {
    const id = dragging()
    endDrag()
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
      <div class="pane-header">
        <h2>Up next</h2>
        <label
          class="toggle"
          title="Add similar songs when the queue runs low (more options in Settings → Autoplay)"
        >
          <input
            type="checkbox"
            checked={props.state.settings()?.autoplay.enabled ?? true}
            onChange={(e) => {
              const enabled = e.currentTarget.checked
              void props.state.run(() => call('settings.patch', { autoplay: { enabled } }))
            }}
          />
          Autoplay
          <Show
            when={
              (props.state.settings()?.autoplay.enabled ?? true) &&
              (props.state.player()?.repeat ?? 'off') !== 'off'
            }
          >
            <span title="Repeat cycles the queue, so nothing new is added">(paused on repeat)</span>
          </Show>
        </label>
      </div>
      <Show when={items().length} fallback={<p class="empty">The queue is empty.</p>}>
        <ol class="list">
          <For each={items()}>
            {(item) => (
              <li
                draggable="true"
                classList={{
                  dragging: dragging() === item.id,
                  'drop-before': dropAt()?.id === item.id && dropAt()!.before,
                  'drop-after': dropAt()?.id === item.id && !dropAt()!.before,
                }}
                onDragStart={() => setDragging(item.id)}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!dragging()) return
                  // Over the dragged song itself, a drop changes nothing: no line.
                  if (dragging() === item.id) return void setDropAt(null)
                  const before = half(e)
                  if (dropAt()?.id !== item.id || dropAt()?.before !== before)
                    setDropAt({ id: item.id, before })
                }}
                onDragLeave={(e) => {
                  // Leaving for a child element of the row isn't leaving the row.
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    if (dropAt()?.id === item.id) setDropAt(null)
                  }
                }}
                onDrop={(e) => drop(item.id, half(e))}
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
                      onChange={(e) => {
                        const sourceId = e.currentTarget.value || null
                        void props.state.run(() => call('queue.pin', { id: item.id, sourceId }))
                      }}
                    >
                      <option value="" selected={!item.pinnedSourceId}>
                        Auto
                      </option>
                      <For each={bySourceOrder(item.sources)}>
                        {(source) => (
                          <option
                            value={source.id}
                            disabled={!source.available}
                            selected={source.id === item.pinnedSourceId}
                          >
                            {sourceLabel(source, item.sources)}
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
