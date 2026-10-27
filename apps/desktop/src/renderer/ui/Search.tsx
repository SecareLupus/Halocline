import type { Recording } from '@halocline/core'
import { createSignal, For, Show } from 'solid-js'
import { call } from './bridge'
import type { AppState } from './store'

export function Search(props: { state: AppState }) {
  const [query, setQuery] = createSignal('')
  const [results, setResults] = createSignal<Recording[]>([])

  const search = (q: string) => {
    setQuery(q)
    void props.state.run(async () =>
      setResults(q.trim() ? await call('library.search', { q }) : []),
    )
  }
  const addFiles = () =>
    // eslint-disable-next-line solid/reactivity -- only called from event handlers
    props.state.run(async () => {
      const added = await call('library.addFiles')
      if (added.length && !query()) setResults(added)
    })
  const enqueue = (recording: Recording, position: 'next' | 'end') =>
    props.state.run(() => call('queue.add', { recordingId: recording.id, position }))

  return (
    <section class="pane">
      <div class="search-row">
        <input
          type="search"
          placeholder="Search your library"
          value={query()}
          onInput={(e) => search(e.currentTarget.value)}
        />
        <button type="button" onClick={() => void addFiles()}>
          Add files…
        </button>
      </div>
      <Show
        when={results().length}
        fallback={<p class="empty">Search, or add some files to start.</p>}
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

export function TrackLabel(props: { recording: Recording }) {
  return (
    <span class="track">
      <span class="title">{props.recording.title}</span>
      <span class="artist">{props.recording.artists.join(', ') || 'Unknown artist'}</span>
    </span>
  )
}
