import type { Recording, SearchResult, YtmSong } from '@halocline/core'
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { call } from './bridge'
import type { AppState } from './store'

/** YouTube Music is searched over the network, so wait for typing to pause. */
const SEARCH_DELAY_MS = 300

export function Search(props: { state: AppState }) {
  const [query, setQuery] = createSignal('')
  const [results, setResults] = createSignal<SearchResult[]>([])
  const [searching, setSearching] = createSignal(false)
  const hasFolders = () => (props.state.settings()?.library.folders.length ?? 0) > 0
  const library = () => results().flatMap((r) => (r.kind === 'library' ? [r.recording] : []))
  const cloud = () => results().flatMap((r) => (r.kind === 'ytm' ? [r.song] : []))
  const cloudOnly = () =>
    new Set(
      results().flatMap((r) =>
        r.kind === 'library' && !r.sources.some((s) => s.kind === 'local') ? [r.recording.id] : [],
      ),
    )

  // Only the latest search may set results, however the responses arrive.
  let latest = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const search = (q: string, delay = SEARCH_DELAY_MS) => {
    clearTimeout(timer)
    const id = ++latest
    if (!q.trim()) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    timer = setTimeout(() => {
      void props.state.run(async () => {
        try {
          const found = await call('search', { q })
          if (id === latest) setResults(found)
        } finally {
          if (id === latest) setSearching(false)
        }
      })
    }, delay)
  }

  // Refresh results as the scanner or edits change the library.
  createEffect(
    on(
      () => props.state.libraryVersion(),
      () => search(query(), 0),
      { defer: true },
    ),
  )

  const addFolder = () => props.state.run(() => call('library.addFolder'))
  const enqueue = (recording: Recording, position: 'next' | 'end') =>
    props.state.run(() => call('queue.add', { recordingId: recording.id, position }))
  const enqueueYtm = (song: YtmSong, position: 'next' | 'end') =>
    props.state.run(() => call('queue.addYtm', { song, position }))
  const saveYtm = (song: YtmSong) => props.state.run(() => call('library.saveYtm', { song }))
  const setStreamSafe = (recording: Recording, streamSafe: boolean) =>
    props.state.run(() => call('library.edit', { id: recording.id, changes: { streamSafe } }))
  const allSafe = () => library().every((r) => r.streamSafe)
  const setAllStreamSafe = (streamSafe: boolean) => {
    const ids = library().map((r) => r.id)
    return props.state.run(() => call('library.editMany', { ids, changes: { streamSafe } }))
  }

  return (
    <section class="pane">
      <div class="search-row">
        <input
          type="search"
          placeholder="Search your library and YouTube Music"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            search(e.currentTarget.value)
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
            {searching()
              ? 'Searching…'
              : query().trim()
                ? 'No results.'
                : hasFolders()
                  ? 'Search by title, artist or album.'
                  : 'Search YouTube Music, or add a music folder to build your library.'}
          </p>
        }
      >
        <Show when={library().length}>
          <div class="results-bar">
            <span class="empty">
              Library: {library().length} · {library().filter((r) => r.streamSafe).length}{' '}
              stream-safe
            </span>
            <button type="button" onClick={() => void setAllStreamSafe(!allSafe())}>
              {allSafe() ? 'Unmark all stream-safe' : 'Mark all stream-safe'}
            </button>
          </div>
          <ul class="list">
            <For each={library()}>
              {(r) => (
                <li>
                  <TrackLabel track={r} />
                  <span class="actions">
                    <Show when={cloudOnly().has(r.id)}>
                      <span class="badge" title="No local file; plays from YouTube Music">
                        cloud
                      </span>
                    </Show>
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
        <Show when={cloud().length}>
          <div class="results-bar">
            <span class="empty">YouTube Music</span>
          </div>
          <ul class="list">
            <For each={cloud()}>
              {(song) => (
                <li>
                  <TrackLabel track={song} />
                  <span class="actions">
                    <button
                      type="button"
                      title="Save to your library"
                      onClick={() => void saveYtm(song)}
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => void enqueueYtm(song, 'next')}>
                      Next
                    </button>
                    <button type="button" onClick={() => void enqueueYtm(song, 'end')}>
                      Add
                    </button>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  )
}

/** What a row needs to show; library recordings and YTM songs both fit. */
interface TrackInfo {
  title: string
  artists: string[]
  album: string | null
  artwork: string | null
}

/** Local cover art is served over artwork://; cloud art is already a URL. */
const artworkSrc = (artwork: string) =>
  artwork.startsWith('https://') ? artwork : `artwork://${artwork}`

export function Artwork(props: { track: TrackInfo; size: number }) {
  return (
    <span class="art" style={{ width: `${props.size}px`, height: `${props.size}px` }}>
      <Show when={props.track.artwork}>
        {(artwork) => <img src={artworkSrc(artwork())} alt="" loading="lazy" />}
      </Show>
    </span>
  )
}

export function TrackLabel(props: { track: TrackInfo }) {
  return (
    <span class="track-row">
      <Artwork track={props.track} size={36} />
      <span class="track">
        <span class="title">{props.track.title}</span>
        <span class="artist">
          {props.track.artists.join(', ') || 'Unknown artist'}
          <Show when={props.track.album}>{(album) => <> · {album()}</>}</Show>
        </span>
      </span>
    </span>
  )
}
