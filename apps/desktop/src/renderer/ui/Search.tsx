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
        <ul class="list">
          <For each={results()}>
            {(r) => (
              <li>
                <TrackLabel recording={r} />
                <span class="actions">
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
