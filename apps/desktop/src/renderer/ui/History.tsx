import type { HistoryEntry } from '@halocline/core'
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { call } from './bridge'
import { contextMenu } from './ContextMenu'
import { TrackLabel } from './Search'
import type { AppState } from './store'

/** "Today", "Yesterday", or a short date, in local time. */
function dayLabel(iso: string): string {
  const day = new Date(iso)
  const today = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(day)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return day.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(day.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  })
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Plays grouped by day, latest first. */
function byDay(entries: HistoryEntry[]): { day: string; entries: HistoryEntry[] }[] {
  const groups: { day: string; entries: HistoryEntry[] }[] = []
  for (const entry of entries) {
    const day = dayLabel(entry.playedAt)
    const last = groups.at(-1)
    if (last?.day === day) last.entries.push(entry)
    else groups.push({ day, entries: [entry] })
  }
  return groups
}

/** Recently played (PLAN §11): what played when, and how it got there. */
export function History(props: { state: AppState }) {
  const [entries, setEntries] = createSignal<HistoryEntry[]>([])
  const [cursor, setCursor] = createSignal<string | null>(null)
  const [confirming, setConfirming] = createSignal(false)

  /** The newest page, keeping any older pages already loaded below it. */
  const refresh = () =>
    // eslint-disable-next-line solid/reactivity -- run on mount and from the effect below
    props.state.run(async () => {
      const page = await call('history.list', {})
      const oldest = page.items.at(-1)?.id
      const older = oldest === undefined ? [] : entries().filter((e) => e.id < oldest)
      setEntries([...page.items, ...older])
      if (!older.length) setCursor(page.nextCursor)
    })
  const loadMore = () =>
    // eslint-disable-next-line solid/reactivity -- only called from event handlers
    props.state.run(async () => {
      const before = cursor()
      if (!before) return
      const page = await call('history.list', { before })
      setEntries([...entries(), ...page.items])
      setCursor(page.nextCursor)
    })
  onMount(() => void refresh())
  // A new track is a new play; library edits change the Save and Safe buttons.
  createEffect(
    on(
      () => [props.state.player()?.current?.queueItemId, props.state.libraryVersion()],
      () => void refresh(),
      { defer: true },
    ),
  )

  // Clearing asks for a second click within a few seconds instead of a dialog.
  let confirmTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(confirmTimer))
  const clear = () => {
    if (!confirming()) {
      setConfirming(true)
      confirmTimer = setTimeout(() => setConfirming(false), 4000)
      return
    }
    clearTimeout(confirmTimer)
    setConfirming(false)
    void props.state.run(async () => {
      await call('history.clear')
      setEntries([])
      setCursor(null)
    })
  }

  const enqueue = (entry: HistoryEntry, position: 'next' | 'end') =>
    props.state.run(() => call('queue.add', { recordingId: entry.recording.id, position }))
  const edit = (entry: HistoryEntry, changes: { streamSafe?: boolean; inLibrary?: boolean }) =>
    props.state.run(() => call('library.edit', { id: entry.recording.id, changes }))
  const radio = (entry: HistoryEntry) =>
    props.state.run(() => call('queue.radio', { recordingId: entry.recording.id }))

  return (
    <section class="pane history">
      <div class="pane-header">
        <h2>Recently played</h2>
        <Show when={entries().length}>
          <button
            type="button"
            class="quiet"
            title="Empties this list; play counts stay"
            onClick={clear}
          >
            {confirming() ? 'Click again to clear' : 'Clear history'}
          </button>
        </Show>
      </div>
      <Show
        when={entries().length}
        fallback={<p class="empty">Nothing played yet. Songs show up here as they start.</p>}
      >
        <For each={byDay(entries())}>
          {(group) => (
            <>
              <h3 class="day">{group.day}</h3>
              <ul class="list">
                <For each={group.entries}>
                  {(entry) => (
                    <li
                      onContextMenu={contextMenu(() => [
                        { label: 'Play next', action: () => void enqueue(entry, 'next') },
                        { label: 'Add to queue', action: () => void enqueue(entry, 'end') },
                        { label: 'Start radio', action: () => void radio(entry) },
                        null,
                        entry.recording.inLibrary
                          ? null
                          : {
                              label: 'Save to library',
                              action: () => void edit(entry, { inLibrary: true }),
                            },
                        {
                          label: entry.recording.streamSafe
                            ? 'Unmark stream-safe'
                            : 'Mark stream-safe',
                          action: () =>
                            void edit(entry, { streamSafe: !entry.recording.streamSafe }),
                        },
                      ])}
                    >
                      <span class="played-at">{timeLabel(entry.playedAt)}</span>
                      <TrackLabel track={entry.recording} />
                      <span class="actions">
                        <Show when={!entry.recording.inLibrary}>
                          <button
                            type="button"
                            class="hover-only"
                            title="Save to your library"
                            onClick={() => void edit(entry, { inLibrary: true })}
                          >
                            Save
                          </button>
                        </Show>
                        <button
                          type="button"
                          class="hover-only"
                          onClick={() => void enqueue(entry, 'next')}
                        >
                          Next
                        </button>
                        <button
                          type="button"
                          class="hover-only"
                          onClick={() => void enqueue(entry, 'end')}
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          class="safe-toggle"
                          classList={{ on: entry.recording.streamSafe }}
                          aria-pressed={entry.recording.streamSafe}
                          title={
                            entry.recording.streamSafe
                              ? 'Stream-safe: click to unmark'
                              : 'Mark stream-safe'
                          }
                          onClick={() =>
                            void edit(entry, { streamSafe: !entry.recording.streamSafe })
                          }
                        >
                          {entry.recording.streamSafe ? 'Safe ✓' : 'Safe?'}
                        </button>
                      </span>
                      {/* Stacked in a column of fixed width, so every row lines up
                          however many a song has. More than three would need a "…"
                          with the rest on hover (PLAN §11). */}
                      <span class="tags">
                        <Show when={entry.origin && entry.origin !== 'user'}>
                          <span
                            class="badge"
                            title={`Queued by ${entry.requestedBy ?? entry.origin}`}
                          >
                            {entry.requestedBy ?? entry.origin}
                          </span>
                        </Show>
                        <Show when={entry.engine}>
                          {(engine) => (
                            <span class={`badge engine-${engine()}`} title="Played from">
                              {engine()}
                            </span>
                          )}
                        </Show>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </>
          )}
        </For>
        <Show when={cursor()}>
          <div class="button-row">
            <button type="button" onClick={() => void loadMore()}>
              Load more
            </button>
          </div>
        </Show>
      </Show>
    </section>
  )
}
