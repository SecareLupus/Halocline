import type {
  LinkProvider,
  Recording,
  Resolution,
  SearchResult,
  YtmCollection,
  YtmCollectionDetail,
  YtmSong,
} from '@halocline/core'
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { call } from './bridge'
import { contextMenu, type MenuItem } from './ContextMenu'
import { bySourceOrder, sourceLabel } from './sources'
import type { AppState } from './store'

/** YouTube Music is searched over the network, so wait for typing to pause. */
const SEARCH_DELAY_MS = 300

export function Search(props: { state: AppState }) {
  const [query, setQuery] = createSignal('')
  const [results, setResults] = createSignal<SearchResult[]>([])
  const [resolution, setResolution] = createSignal<Resolution | null>(null)
  /** A pasted album or playlist link, shown like a search result. */
  const [pasted, setPasted] = createSignal<YtmCollection | null>(null)
  const [searching, setSearching] = createSignal(false)
  const hasFolders = () => (props.state.settings()?.library.folders.length ?? 0) > 0
  const library = () => results().flatMap((r) => (r.kind === 'library' ? [r.recording] : []))
  const cloud = () => results().flatMap((r) => (r.kind === 'ytm' ? [r.song] : []))
  const collections = () =>
    results().flatMap((r) => (r.kind === 'ytm-collection' ? [r.collection] : []))
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
      setPasted(null)
      setSearching(false)
      return
    }
    setSearching(true)
    timer = setTimeout(() => {
      void props.state.run(async () => {
        try {
          // A pasted track link is resolved (PLAN §5); anything else is a search.
          if (isLink(q)) {
            // An album or playlist link shows the collection; any other link is a song.
            const collection = await call('collection.match', { input: q.trim() })
            if (collection) {
              if (id === latest) {
                collectionState(collection.ref).setDetail(collection)
                setPasted(collection)
                setResolution(null)
                setResults([])
              }
              return
            }
            const found = await call('resolve', { input: q.trim() })
            if (id === latest) {
              setResolution(found)
              setPasted(null)
              setResults([])
            }
          } else {
            const found = await call('search', { q })
            if (id === latest) {
              setResults(found)
              setPasted(null)
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
  const radio = (seed: RadioSeed) => props.state.run(() => call('queue.radio', seed))
  const setStreamSafe = (recording: Recording, streamSafe: boolean) =>
    props.state.run(() => call('library.edit', { id: recording.id, changes: { streamSafe } }))
  const merge = (into: Recording, from: Recording) =>
    props.state.run(async () => {
      await call('library.merge', { id: into.id, from: [from.id] })
      setMergeInto(null)
    })
  /**
   * Fixes for matching (PLAN §3), on the right-click menu: merge a duplicate into
   * this recording, or split a source that's a different song off onto its own.
   */
  const fixes = (r: Recording): MenuItem[] => {
    const sources = sourcesOf().get(r.id) ?? []
    return [
      { label: 'Merge a duplicate into this…', action: () => setMergeInto(r) },
      ...(sources.length > 1
        ? bySourceOrder(sources).map((source) => ({
            label: `Split off: ${sourceLabel(source, sources)}`,
            action: () =>
              void props.state.run(() =>
                call('library.split', { id: r.id, sourceIds: [source.id] }),
              ),
          }))
        : []),
    ]
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
            radio={(input) => void radio({ input })}
          />
        )}
      </Show>
      <Show when={pasted()}>
        {(c) => (
          <ul class="list">
            <CollectionRow
              collection={c()}
              state={props.state}
              enqueueSong={(song, position) => void enqueueYtm(song, position)}
              radio={(song) => void radio({ song })}
            />
          </ul>
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
        when={results().length || resolution() || pasted()}
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
                <li
                  onContextMenu={contextMenu(() => [
                    ...queueItems(
                      (position) => void enqueue(r, position),
                      () => void radio({ recordingId: r.id }),
                    ),
                    null,
                    {
                      label: r.streamSafe ? 'Unmark stream-safe' : 'Mark stream-safe',
                      action: () => void setStreamSafe(r, !r.streamSafe),
                    },
                    ...fixes(r),
                  ])}
                >
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
                    <button
                      type="button"
                      class="hover-only"
                      onClick={() => void enqueue(r, 'next')}
                    >
                      Next
                    </button>
                    <button type="button" class="hover-only" onClick={() => void enqueue(r, 'end')}>
                      Add
                    </button>
                    <Show when={mergeInto()}>
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
                <li
                  onContextMenu={contextMenu(() => [
                    ...queueItems(
                      (position) => void enqueueYtm(song, position),
                      () => void radio({ song }),
                    ),
                    null,
                    { label: 'Save to library', action: () => void saveYtm(song) },
                  ])}
                >
                  <TrackLabel track={song} />
                  <span class="actions">
                    <button
                      type="button"
                      class="hover-only"
                      title="Save to your library"
                      onClick={() => void saveYtm(song)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      class="hover-only"
                      onClick={() => void enqueueYtm(song, 'next')}
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      class="hover-only"
                      onClick={() => void enqueueYtm(song, 'end')}
                    >
                      Add
                    </button>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={collections().length}>
          <div class="results-bar">
            <span class="empty">Albums &amp; playlists</span>
          </div>
          <ul class="list">
            <For each={collections()}>
              {(c) => (
                <CollectionRow
                  collection={c}
                  state={props.state}
                  enqueueSong={(song, position) => void enqueueYtm(song, position)}
                  radio={(song) => void radio({ song })}
                />
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  )
}

/** Search can start radio from a library recording, a YTM song or a link candidate. */
type RadioSeed = { recordingId: string } | { song: YtmSong } | { input: string }

/** Right-click items for any song: queue it, or start radio from it. */
function queueItems(enqueue: (position: 'next' | 'end') => void, radio: () => void): MenuItem[] {
  return [
    { label: 'Play next', action: () => enqueue('next') },
    { label: 'Add to queue', action: () => enqueue('end') },
    { label: 'Start radio', action: radio },
  ]
}

const collectionStates = new Map<string, ReturnType<typeof newCollectionState>>()

function newCollectionState() {
  const [open, setOpen] = createSignal(false)
  const [detail, setDetail] = createSignal<YtmCollectionDetail | null>(null)
  const [note, setNote] = createSignal<string | null>(null)
  return { open, setOpen, detail, setDetail, note, setNote }
}

/** One album's or playlist's open/closed state, tracks and last note, by ref. */
function collectionState(ref: string) {
  let state = collectionStates.get(ref)
  if (!state) collectionStates.set(ref, (state = newCollectionState()))
  return state
}

/**
 * An album or playlist from YouTube Music: queue all of it, or open it to queue
 * single tracks. Its tracks are fetched when first opened or added.
 */
function CollectionRow(props: {
  collection: YtmCollection
  state: AppState
  enqueueSong: (song: YtmSong, position: 'next' | 'end') => void
  radio: (song: YtmSong) => void
}) {
  // Kept per album or playlist, not per row: the results are re-fetched (and the
  // rows rebuilt) whenever the library changes, e.g. right after "Add all".
  // eslint-disable-next-line solid/reactivity -- a row's ref never changes
  const { open, setOpen, detail, setDetail, note, setNote } = collectionState(props.collection.ref)
  const kind = () => (props.collection.kind === 'album' ? 'Album' : 'Playlist')
  const toggle = () =>
    // eslint-disable-next-line solid/reactivity -- only called from event handlers
    props.state.run(async () => {
      if (!detail()) setDetail(await call('collection.get', { ref: props.collection.ref }))
      setOpen(!open())
    })
  const addAll = (position: 'next' | 'end') =>
    // eslint-disable-next-line solid/reactivity -- only called from event handlers
    props.state.run(async () => {
      const added = await call('queue.addCollection', { ref: props.collection.ref, position })
      const n = added.items.length
      setNote(
        `Added ${n} song${n === 1 ? '' : 's'}` +
          (added.skipped ? ` (${added.skipped} not stream-safe, left out)` : ''),
      )
    })
  return (
    <li class="collection">
      <div
        class="collection-row"
        onContextMenu={contextMenu(() => [
          { label: open() ? 'Hide tracks' : 'Show tracks', action: () => void toggle() },
          null,
          { label: 'Play next', action: () => void addAll('next') },
          { label: 'Add all to queue', action: () => void addAll('end') },
        ])}
      >
        <TrackLabel
          track={{
            title: props.collection.title,
            artists: [[kind(), props.collection.by].filter(Boolean).join(' · ')],
            album: props.collection.year,
            artwork: props.collection.artwork,
          }}
        />
        <span class="actions">
          <button type="button" aria-expanded={open()} onClick={() => void toggle()}>
            {open() ? 'Hide tracks' : 'Tracks'}
          </button>
          <button
            type="button"
            class="hover-only"
            title={`Play this ${kind().toLowerCase()} next`}
            onClick={() => void addAll('next')}
          >
            Next
          </button>
          <button
            type="button"
            class="hover-only"
            title={`Add the whole ${kind().toLowerCase()} to the queue`}
            onClick={() => void addAll('end')}
          >
            Add all
          </button>
        </span>
      </div>
      <Show when={note()}>{(text) => <p class="empty collection-note">{text()}</p>}</Show>
      <Show when={open() && detail()}>
        {(d) => (
          <ol class="list tracks">
            <For each={d().songs} fallback={<li class="empty">No playable tracks.</li>}>
              {(song) => (
                <li
                  onContextMenu={contextMenu(() =>
                    queueItems(
                      (position) => props.enqueueSong(song, position),
                      () => props.radio(song),
                    ),
                  )}
                >
                  <TrackLabel track={song} />
                  <span class="actions">
                    <button
                      type="button"
                      class="hover-only"
                      onClick={() => props.enqueueSong(song, 'next')}
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      class="hover-only"
                      onClick={() => props.enqueueSong(song, 'end')}
                    >
                      Add
                    </button>
                  </span>
                </li>
              )}
            </For>
          </ol>
        )}
      </Show>
    </li>
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
  radio: (input: string) => void
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
            <li
              classList={{ best: c.input === props.resolution.match?.input }}
              onContextMenu={contextMenu(() =>
                queueItems(
                  (position) => props.enqueue(c.input, position),
                  () => props.radio(c.input),
                ),
              )}
            >
              <TrackLabel track={c} />
              <span class="actions">
                <span class="badge" title="How sure the match is">
                  {c.source === 'library' ? 'library' : 'YouTube Music'}
                  {c.score ? ` · ${Math.round(c.score * 100)}%` : ''}
                </span>
                <button
                  type="button"
                  class="hover-only"
                  onClick={() => props.enqueue(c.input, 'next')}
                >
                  Next
                </button>
                <button
                  type="button"
                  class="hover-only"
                  onClick={() => props.enqueue(c.input, 'end')}
                >
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

/** `size` in pixels, or any CSS length. */
export function Artwork(props: { track: TrackInfo; size: number | string }) {
  const size = () => (typeof props.size === 'number' ? `${props.size}px` : props.size)
  return (
    <span class="art" style={{ width: size(), height: size() }}>
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
