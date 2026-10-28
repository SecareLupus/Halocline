import type {
  LinkProvider,
  Recording,
  Resolution,
  SearchResult,
  Source,
  YtmSong,
} from '@halocline/core'
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { call } from './bridge'
import { bySourceOrder, sourceLabel } from './sources'
import type { AppState } from './store'

/** YouTube Music is searched over the network, so wait for typing to pause. */
const SEARCH_DELAY_MS = 300

export function Search(props: { state: AppState }) {
  const [query, setQuery] = createSignal('')
  const [results, setResults] = createSignal<SearchResult[]>([])
  const [resolution, setResolution] = createSignal<Resolution | null>(null)
  const [searching, setSearching] = createSignal(false)
  const hasFolders = () => (props.state.settings()?.library.folders.length ?? 0) > 0
  const library = () => results().flatMap((r) => (r.kind === 'library' ? [r.recording] : []))
  const cloud = () => results().flatMap((r) => (r.kind === 'ytm' ? [r.song] : []))
  const sourcesOf = () =>
    new Map(results().flatMap((r) => (r.kind === 'library' ? [[r.recording.id, r.sources]] : [])))
  const cloudOnly = (id: string) =>
    !sourcesOf()
      .get(id)
      ?.some((s) => s.kind === 'local')
  /** The recording a duplicate will be merged into, picked from a row's menu. */
  const [mergeInto, setMergeInto] = createSignal<Recording | null>(null)

  // Only the latest search may set results, however the responses arrive.
  let latest = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const search = (q: string, delay = SEARCH_DELAY_MS) => {
    clearTimeout(timer)
    const id = ++latest
    if (!q.trim()) {
      setResults([])
      setResolution(null)
      setSearching(false)
      return
    }
    setSearching(true)
    timer = setTimeout(() => {
      void props.state.run(async () => {
        try {
          // A pasted track link is resolved (PLAN §5); anything else is a search.
          if (isLink(q)) {
            const found = await call('resolve', { input: q.trim() })
            if (id === latest) {
              setResolution(found)
              setResults([])
            }
          } else {
            const found = await call('search', { q })
            if (id === latest) {
              setResults(found)
              setResolution(null)
            }
          }
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
  const enqueueInput = (input: string, position: 'next' | 'end') =>
    props.state.run(() => call('queue.addInput', { input, position }))
  const enqueueYtm = (song: YtmSong, position: 'next' | 'end') =>
    props.state.run(() => call('queue.addYtm', { song, position }))
  const saveYtm = (song: YtmSong) => props.state.run(() => call('library.saveYtm', { song }))
  const setStreamSafe = (recording: Recording, streamSafe: boolean) =>
    props.state.run(() => call('library.edit', { id: recording.id, changes: { streamSafe } }))
  const merge = (into: Recording, from: Recording) =>
    props.state.run(async () => {
      await call('library.merge', { id: into.id, from: [from.id] })
      setMergeInto(null)
    })
  // Merge and split live in one menu per row, to keep the row's buttons few.
  const onMenu = (r: Recording, choice: string) => {
    if (choice === 'merge') setMergeInto(r)
    else if (choice)
      void props.state.run(() => call('library.split', { id: r.id, sourceIds: [choice] }))
  }
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
          placeholder="Search, or paste a song link (YouTube, Spotify, Apple Music, Tidal, Deezer)"
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
      <Show when={resolution()}>
        {(r) => (
          <LinkResult
            resolution={r()}
            enqueue={(input, position) => void enqueueInput(input, position)}
          />
        )}
      </Show>
      <Show when={mergeInto()}>
        {(into) => (
          <div class="results-bar merge-bar">
            <span>
              Merging a duplicate into <strong>{into().title}</strong>: search for it if needed,
              then press its Merge button.
            </span>
            <button type="button" onClick={() => setMergeInto(null)}>
              Cancel
            </button>
          </div>
        )}
      </Show>
      <Show
        when={results().length || resolution()}
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
                    <Show when={cloudOnly(r.id)}>
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
                    <Show
                      when={mergeInto()}
                      fallback={
                        <RecordingMenu
                          sources={sourcesOf().get(r.id) ?? []}
                          onChoose={(choice) => onMenu(r, choice)}
                        />
                      }
                    >
                      {(into) => (
                        <Show
                          when={into().id !== r.id}
                          fallback={<span class="badge">keeping</span>}
                        >
                          <button
                            type="button"
                            title={`Merge into "${into().title}"`}
                            onClick={() => void merge(into(), r)}
                          >
                            Merge
                          </button>
                        </Show>
                      )}
                    </Show>
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

/**
 * Fixes for matching (PLAN §3): merge a duplicate into this recording, or split a
 * source that's a different song off onto its own.
 */
function RecordingMenu(props: { sources: Source[]; onChoose: (choice: string) => void }) {
  return (
    <select
      class="more"
      aria-label="More"
      title="Merge a duplicate, or split off a source that's a different song"
      value=""
      onChange={(e) => {
        const choice = e.currentTarget.value
        e.currentTarget.value = ''
        props.onChoose(choice)
      }}
    >
      <option value="">⋯</option>
      <option value="merge">Merge a duplicate into this…</option>
      <Show when={props.sources.length > 1}>
        <For each={bySourceOrder(props.sources)}>
          {(source) => (
            <option value={source.id}>Split off: {sourceLabel(source, props.sources)}</option>
          )}
        </For>
      </Show>
    </select>
  )
}

const isLink = (q: string) => /^(https?:\/\/|spotify:)/i.test(q.trim())

const PROVIDERS: Record<LinkProvider, string> = {
  ytm: 'YouTube Music',
  youtube: 'YouTube',
  spotify: 'Spotify',
  tidal: 'Tidal',
  apple: 'Apple Music',
  deezer: 'Deezer',
}

/** A resolved link: what it was read as, then the match (if confident) and alternatives. */
function LinkResult(props: {
  resolution: Resolution
  enqueue: (input: string, position: 'next' | 'end') => void
}) {
  const link = () => props.resolution.link
  return (
    <>
      <div class="results-bar">
        <span class="empty">
          <Show when={link()} fallback="Link">
            {(l) => (
              <>
                {PROVIDERS[l().provider]}: {l().artists.join(', ')} · {l().title}
              </>
            )}
          </Show>
        </span>
        <span class="empty">
          {props.resolution.match
            ? 'Confident match'
            : props.resolution.candidates.length
              ? 'Not sure; pick one'
              : 'No match found'}
        </span>
      </div>
      <ul class="list">
        <For each={props.resolution.candidates}>
          {(c) => (
            <li classList={{ best: c.input === props.resolution.match?.input }}>
              <TrackLabel track={c} />
              <span class="actions">
                <span class="badge" title="How sure the match is">
                  {c.source === 'library' ? 'library' : 'YouTube Music'}
                  {c.score ? ` · ${Math.round(c.score * 100)}%` : ''}
                </span>
                <button type="button" onClick={() => props.enqueue(c.input, 'next')}>
                  Next
                </button>
                <button type="button" onClick={() => props.enqueue(c.input, 'end')}>
                  Add
                </button>
              </span>
            </li>
          )}
        </For>
      </ul>
    </>
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
