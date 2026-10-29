import { onCleanup, onMount, Show } from 'solid-js'
import {
  CurrentTrack,
  Progress,
  RepeatButton,
  ShuffleButton,
  Transport,
  usePlayback,
  Volume,
} from './NowPlaying'
import { QueueList } from './QueueList'
import { Artwork } from './Search'
import type { AppState } from './store'

/**
 * The player view, opened from the bar's art: big art, the progress bar and the
 * controls first, with the queue below. No search. The ⌄ button or Escape closes it.
 */
export function PlayerView(props: { state: AppState; onClose: () => void }) {
  // eslint-disable-next-line solid/reactivity -- the app's state object never changes
  const playback = usePlayback(props.state)
  onMount(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) props.onClose()
    }
    document.addEventListener('keydown', keys)
    onCleanup(() => document.removeEventListener('keydown', keys))
  })

  return (
    <div class="player-view">
      <button
        type="button"
        class="collapse"
        aria-label="Back to search and the queue"
        title="Back to search and the queue"
        onClick={() => props.onClose()}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <section class="hero">
        <Show when={playback.player()?.current} fallback={<span class="art hero-art" />}>
          {(c) => <Artwork track={c().recording} size="var(--hero-art)" />}
        </Show>
        <div class="current hero-info">
          <CurrentTrack playback={playback} />
        </div>
        <Progress playback={playback} />
        <div class="transport hero-controls">
          <ShuffleButton playback={playback} />
          <Transport playback={playback} />
          <RepeatButton playback={playback} />
        </div>
        <Volume playback={playback} />
      </section>
      <QueueList state={props.state} />
    </div>
  )
}
