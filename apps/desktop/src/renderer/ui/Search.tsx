import type { Recording } from '@halocline/core'
import { createEffect, createSignal, For, on, Show } from 'solid-js'
import { call } from './bridge'
import type { AppState } from './store'

export function Search(props: { state: AppState }) {
  const [query, setQuery] = createSignal('')
  const [results, setResults] = createSignal<Recording[]>([])
  const hasFolders = () => (props.state.settings()?.library.folders.length ?? 0) > 0

  const search = (q: string) =>
    props.state.run(async () => setResults(q.trim() ? await call('library.search', { q }) : []))

  // Refresh results as the scanner adds or changes tracks.
  createEffect(
    on(
      () => props.state.libraryVersion(),
      () => void search(query()),
      { defer: true },
    ),
  )

  const addFolder = () => props.state.run(() => call('library.addFolder'))
  const enqueue = (recording: Recording, position: 'next' | 'end') =>
    props.state.run(() => call('queue.add', { recordingId: recording.id, position }))
  const setStreamSafe = (recording: Recording, streamSafe: boolean) =>
    props.state.run(() => call('library.edit', { id: recording.id, changes: { streamSafe } }))
  const allSafe = () => results().every((r) => r.streamSafe)
  const setAllStreamSafe = (streamSafe: boolean) => {
    const ids = results().map((r) => r.id)
    return props.state.run(() => call('library.editMany', { ids, changes: { streamSafe } }))
  }

  return (
    <section class="pane">
      <div class="search-row">
        <input
          type="search"
          placeholder="Search your library"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            void search(e.currentTarget.value)
          }}
        />
        <button type="button" onClick={() => void addFolder()}>
          Add folder…
        </button>
      </div>
      <Show
        when={results().length}
        fallback={
          <p class="empty">
            {hasFolders()
              ? 'Search by title, artist or album.'
              : 'Add a music folder to build your library.'}
          </p>
        }
      >
        <div class="results-bar">
          <span class="empty">
            {results().length} results · {results().filter((r) => r.streamSafe).length} stream-safe
          </span>
          <button type="button" onClick={() => void setAllStreamSafe(!allSafe())}>
            {allSafe() ? 'Unmark all stream-safe' : 'Mark all stream-safe'}
          </button>
        </div>
        <ul class="list">
          <For each={results()}>
            {(r) => (
              <li>
                <TrackLabel recording={r} />
                <span class="actions">
                  <button
                    type="button"
                    class="safe-toggle"
                    classList={{ on: r.streamSafe }}
                    aria-pressed={r.streamSafe}
                    title={r.streamSafe ? 'Stream-safe: click to unmark' : 'Mark stream-safe'}
                    onClick={() => void setStreamSafe(r, !r.streamSafe)}
                  >
                    {r.streamSafe ? 'Safe ✓' : 'Safe?'}
                  </button>
                  <button type="button" onClick={() => void enqueue(r, 'next')}>
                    Next
                  </button>
                  <button type="button" onClick={() => void enqueue(r, 'end')}>
                    Add
                  </button>
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  )
}

export function Artwork(props: { recording: Recording; size: number }) {
  return (
    <span class="art" style={{ width: `${props.size}px`, height: `${props.size}px` }}>
      <Show when={props.recording.artwork}>
        {(name) => <img src={`artwork://${name()}`} alt="" loading="lazy" />}
      </Show>
    </span>
  )
}

export function TrackLabel(props: { recording: Recording }) {
  return (
    <span class="track-row">
      <Artwork recording={props.recording} size={36} />
      <span class="track">
        <span class="title">{props.recording.title}</span>
        <span class="artist">
          {props.recording.artists.join(', ') || 'Unknown artist'}
          <Show when={props.recording.album}>{(album) => <> · {album()}</>}</Show>
        </span>
      </span>
    </span>
  )
}
